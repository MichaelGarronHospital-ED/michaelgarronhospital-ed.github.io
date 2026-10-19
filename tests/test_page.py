"""Browser tests for the dashboard page (index.html, app.js, styles.css).

The page is loaded at its real address, https://michaelgarronhospital-ed.github.io/,
but nothing reaches the network: Playwright routes answer every request from the
working copy on disk, and answer the status checks (HEAD requests) the way each test
says. Any other request (SharePoint, CPOE, anything) fails the test. page.clock runs
the page's timers (1 s start, 5 s retry, 8 s and 10 s timeouts) without waiting.

Needs Playwright (the shared ~/.venvs/mgh-ed-tools has it):

    ~/.venvs/mgh-ed-tools/bin/python -m unittest discover -s tests -p 'test_page.py'

The tool list is the frozen fixture in tests/fixtures (five tools), and index.html is
served with its plain list rewritten from that fixture, so adding or renaming a real
tool never breaks a test. One test loads the real tools.json and index.html as they are.

Runs in Chromium and WebKit (Safari's engine). DASHBOARD_BROWSERS=chromium limits it.
The accessibility test uses axe-core from ../patient-hub/node_modules (skipped if missing).
"""

import copy
import json
import os
import re
import sys
import unittest
import urllib.parse
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(REPO / "scripts"))
import check_tools  # noqa: E402

SITE = "https://michaelgarronhospital-ed.github.io"
HUB = "https://mgh-ed-patient-hub.pages.dev"
ADDRESS = "MGHEmergencyDepartmentAdministration@tehn.ca"
AXE = REPO.parent / "patient-hub" / "node_modules" / "axe-core" / "axe.min.js"
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
         ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon"}
NETWORK_NOISE = ("Failed to load resource",)
LONG_NOTICE = ("Closed for planned updates on Friday from 3 pm to 5 pm. Please use the paper forms "
               "at the desk until then. Thank you for your patience.")

# Runs in every page before its own scripts: lets a test set the page hidden or
# visible and the device online or offline, and records whether the plain fallback
# list was ever visible (and whether it was hidden again after showing).
INIT = """
(() => {
  window.__online = %s;
  Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get() { return window.__online; } });
  window.__setOnline = (v) => { window.__online = v; window.dispatchEvent(new Event(v ? "online" : "offline")); };
  window.__vis = %s;
  Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get() { return window.__vis; } });
  Object.defineProperty(Document.prototype, "hidden", { configurable: true, get() { return window.__vis !== "visible"; } });
  window.__setVis = (v) => { window.__vis = v; document.dispatchEvent(new Event("visibilitychange")); };
  window.__plainEverVisible = false;
  window.__plainHiddenAgain = false;
  const look = () => {
    const p = document.querySelector("#tools > .plain");
    if (!p) return;
    if (getComputedStyle(p).visibility === "visible") window.__plainEverVisible = true;
    else if (window.__plainEverVisible) window.__plainHiddenAgain = true;
  };
  document.addEventListener("DOMContentLoaded", () => {
    look();
    const p = document.querySelector("#tools > .plain");
    window.__plainAtStart = p ? getComputedStyle(p).visibility : "none";
    new MutationObserver(look).observe(document.documentElement, { subtree: true, childList: true, attributes: true });
  });
  if (%s) { const loop = () => { look(); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
})();
"""


FIXTURE = json.loads((FIXTURES / "tools.json").read_text())
CHECKED = [t["name"] for t in FIXTURE if t.get("check") is True]   # Motion Voting, Physician Hiring, Patient Hub


def tools_json():
    """A fresh copy of the fixture tool list."""
    return copy.deepcopy(FIXTURE)


def tool(tools, name):
    return next(t for t in tools if t["name"] == name)


def index_for(tools):
    """The real index.html with its plain list rewritten from `tools`, as the check would."""
    html = (REPO / "index.html").read_text()
    report = check_tools.Report()
    start, end, indent = check_tools.locate_fallback(html, report)
    assert not report.errors, report.errors
    return html[:start] + check_tools.fallback_block(tools, indent, "\n") + html[end:]


class Harness:
    """One browser context with routes. plans[key] is a list of steps, one per request
    to that key (the last one repeats): an HTTP status, "abort", "hang" (never answer)
    or "hold" (kept in held[key] until the test answers it)."""

    KEYS = ("hiring", "voting", "hub", "control")

    def __init__(self, test, browser, js=True, color_scheme="light", viewport=(1024, 800), hidden=False,
                 clock=True, clock_time="2026-10-16T12:00:00-04:00", index_html=None, tools=None,
                 tools_body=None, app_js=None, tools_get="ok", poll=False, real=False, online=True,
                 app_get="ok", timezone="America/Toronto", has_touch=False):
        self.test = test
        self.plans = {k: [200] for k in self.KEYS}
        self.requests = []          # (key, method, mode)
        self.unexpected = []
        self.held = {k: [] for k in self.KEYS + ("tools", "app")}
        self.hung = []
        self.errors = []            # console errors and page errors
        self.warnings = []
        self.real = real
        if real:                    # the real tools.json and index.html, as they are
            self.index_html, self.tools_body = index_html, tools_body
        else:                       # the fixture, with the plain list made from it
            self.index_html = index_html if index_html is not None else index_for(FIXTURE)
            self.tools_body = tools_body if tools_body is not None else json.dumps(tools if tools is not None else FIXTURE)
        self.app_js = app_js
        self.tools_get = tools_get
        self.app_get = app_get
        self.ctx = browser.new_context(java_script_enabled=js, color_scheme=color_scheme,
                                       viewport={"width": viewport[0], "height": viewport[1]},
                                       timezone_id=timezone, locale="en-CA", has_touch=has_touch)
        self.ctx.add_init_script(INIT % ("true" if online else "false", json.dumps("hidden" if hidden else "visible"),
                                         "true" if poll else "false"))
        self.ctx.route("**/*", self._route)
        self.page = self.ctx.new_page()
        self.page.on("console", self._console)
        self.page.on("pageerror", lambda e: self.errors.append("pageerror: %s" % e))
        if clock and js:
            self.page.clock.install(time=clock_time)
        test.addCleanup(self.close)

    def close(self):
        for route in self.hung + [r for k in self.held for r in self.held[k]]:
            try:
                route.abort()
            except Exception:
                pass
        self.hung, self.held = [], {k: [] for k in self.held}
        try:
            self.ctx.close()
        except Exception:
            pass

    def _console(self, msg):
        if msg.type == "error":
            self.errors.append("console.error: " + msg.text)
        elif msg.type == "warning":
            self.warnings.append(msg.text)

    # ---- routes -------------------------------------------------------------
    def _route(self, route):
        req = route.request
        url = urllib.parse.urlsplit(req.url)
        origin = "%s://%s" % (url.scheme, url.netloc)
        headers = req.headers
        mode = headers.get("sec-fetch-mode") or ("cors" if "origin" in headers else "no-cors")
        if origin == SITE:
            path = url.path
            if path.startswith("/mgh-ed-hiring/"):
                return self._answer(route, "hiring", req.method, mode)
            if path.startswith("/mgh-ed-motion-voting/"):
                return self._answer(route, "voting", req.method, mode)
            if path == "/tools.json" and req.method == "HEAD":
                return self._answer(route, "control", req.method, mode)
            return self._file(route, path)
        if origin == HUB:
            return self._answer(route, "hub", req.method, mode)
        self.unexpected.append(req.url)
        route.abort()

    def _answer(self, route, key, method, mode):
        n = sum(1 for k, _, _ in self.requests if k == key)
        self.requests.append((key, method, mode))
        plan = self.plans[key]
        self._do(route, key, plan[min(n, len(plan) - 1)])

    def _do(self, route, key, step):
        if step == "abort":
            route.abort("failed")
        elif step == "hang":
            self.hung.append(route)
        elif step == "hold":
            self.held[key].append(route)
        else:
            headers = {"access-control-allow-origin": "*"} if key == "hub" else {}
            if step == "200-no-acao":
                step, headers = 200, {}
            route.fulfill(status=int(step), headers=headers, body="")

    def release(self, key, step):
        while self.held[key]:
            self._do(self.held[key].pop(0), key, step)

    def _file(self, route, path):
        name = "index.html" if path in ("/", "/index.html") else path.lstrip("/")
        if name == "tools.json" and self.tools_get != "ok":
            if self.tools_get == "hang":
                self.hung.append(route)
            else:
                self.held["tools"].append(route)
            return
        if name == "app.js" and self.app_get == "hold":
            self.held["app"].append(route)
            return
        body = None
        if name.startswith("icons/") and not self.real and (FIXTURES / name).is_file():
            return route.fulfill(status=200, body=(FIXTURES / name).read_bytes(), headers={"content-type": TYPES[".svg"]})
        if name == "index.html" and self.index_html is not None:
            body = self.index_html
        elif name == "tools.json" and self.tools_body is not None:
            body = self.tools_body
        elif name == "app.js" and self.app_js is not None:
            if isinstance(self.app_js, int):
                return route.fulfill(status=self.app_js, body="Not found")
            body = self.app_js
        file = REPO / name
        if body is None:
            if not file.is_file() or ".." in name:
                return route.fulfill(status=404, body="Not found")
            return route.fulfill(status=200, body=file.read_bytes(),
                                 headers={"content-type": TYPES.get(file.suffix, "application/octet-stream")})
        return route.fulfill(status=200, body=body, headers={"content-type": TYPES.get(Path(name).suffix, "text/plain")})

    def release_tools(self):
        while self.held["tools"]:
            route = self.held["tools"].pop(0)
            route.fulfill(status=200, body=self.tools_body, headers={"content-type": TYPES[".json"]})

    def release_app(self):
        while self.held["app"]:
            self.held["app"].pop(0).fulfill(status=200, body=(REPO / "app.js").read_bytes(),
                                            headers={"content-type": TYPES[".js"]})

    # ---- driving -----------------------------------------------------------
    def open(self, wait_tiles=True, wait_until="load"):
        self.page.goto(SITE + "/", wait_until=wait_until)
        if wait_tiles:
            self.page.wait_for_selector("#tools .card")
        return self.page

    def tick(self, ms, step=250):
        """Move the page's clock forward in small steps, letting answers arrive between."""
        done = 0
        while done < ms:
            n = min(step, ms - done)
            self.page.clock.run_for(n)
            self.page.wait_for_timeout(12)
            done += n

    def wait_until(self, pred, what, timeout_ms=5000):
        waited = 0
        while not pred():
            if waited >= timeout_ms:
                self.test.fail("timed out waiting for " + what)
            self.page.wait_for_timeout(20)
            waited += 20

    def count(self, key=None):
        return sum(1 for k, _, _ in self.requests if key is None or k == key)

    def checks(self):
        return sum(1 for k, _, _ in self.requests if k != "control")

    def set_plan(self, **plans):
        for k, v in plans.items():
            self.plans[k] = v if isinstance(v, list) else [v]

    def statuses(self):
        return self.page.eval_on_selector_all(".status .ed-pill", "els => els.map(e => e.closest('.card').querySelector('.main').textContent)")

    def announced(self):
        return self.page.text_content("#status-announce")

    def assert_clean(self, allow_network=False, allow=()):
        errs = [e for e in self.errors
                if not (allow_network and any(n in e for n in NETWORK_NOISE))
                and not any(a in e for a in allow)]
        self.test.assertEqual(errs, [], "console errors")
        self.test.assertEqual(self.unexpected, [], "requests to addresses the page must never ask")


class PageTests:
    BROWSER = "chromium"

    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = getattr(cls.pw, cls.BROWSER).launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def h(self, **kw):
        return Harness(self, self.browser, **kw)

    def warn_after_checks(self, h, ms=25000):
        h.tick(ms)

    # 1
    def test_01_all_healthy(self):
        h = self.h()
        page = h.open()
        self.assertEqual(page.evaluate("window.__plainAtStart"), "hidden")
        self.assertEqual(page.locator("#tools .card").count(), len(FIXTURE))
        h.tick(25000)
        self.assertEqual(h.checks(), len(CHECKED))          # one each for voting, hiring, Patient Hub
        self.assertEqual(h.count("control"), 0)
        self.assertEqual(page.locator(".status").count(), 0)
        self.assertEqual(h.announced(), "")
        self.assertEqual(page.locator("#tools > .plain").count(), 0)
        self.assertFalse(page.evaluate("window.__plainEverVisible"))
        h.assert_clean()

    # 2
    def test_02_hiring_404_twice(self):
        h = self.h()
        h.set_plan(hiring=404)
        page = h.open()
        h.tick(25000)
        self.assertEqual(h.count("hiring"), 2)
        self.assertEqual(h.statuses(), ["Physician Hiring"])
        main = page.locator('.card:has(.status) .main')
        ids = main.get_attribute("aria-describedby").split()
        pill = page.locator(".status .ed-pill")
        self.assertIn(pill.get_attribute("id"), ids)
        self.assertEqual(pill.inner_text().strip(), "Not loading right now")
        self.assertEqual(h.announced(), "Physician Hiring is not loading right now.")
        href = page.locator(".status-report").get_attribute("href")
        self.assertTrue(href.startswith("mailto:" + ADDRESS + "?subject="), href)
        q = urllib.parse.parse_qs(href.split("?", 1)[1])
        self.assertEqual(q["subject"], ["[ED tools] Physician Hiring is not loading"])
        body = q["body"][0]
        self.assertIn("Tool: Physician Hiring (https://michaelgarronhospital-ed.github.io/mgh-ed-hiring/)", body)
        self.assertIn("The ED tools page said it was not loading at 2026-10-16 12:00.", body)
        self.assertTrue(body.endswith("What happened when you tried it:\r\n\r\n" + "For tool problems only. Not for "
                                      "medical questions. Please do not write names, health card numbers or health details."))
        h.assert_clean(allow_network=True)

    # 3
    def test_03_hub_network_failure(self):
        h = self.h()
        h.set_plan(hub="abort")
        h.open()
        h.tick(25000)
        modes = [m for k, _, m in h.requests if k == "hub"]
        self.assertEqual(modes, ["cors", "no-cors", "cors", "no-cors"])
        self.assertEqual(h.statuses(), ["Patient Hub"])
        h.assert_clean(allow_network=True)

    # 4
    def test_04_blip(self):
        h = self.h()
        h.set_plan(hiring=[500, 200])
        page = h.open()
        h.tick(25000)
        self.assertEqual(h.count("hiring"), 2)
        self.assertEqual(page.locator(".status").count(), 0)
        h.assert_clean(allow_network=True)

    # 5
    def test_05_device_offline(self):
        h = self.h()
        h.set_plan(hiring="abort", voting="abort", hub="abort", control="abort")
        page = h.open()
        h.tick(25000)
        self.assertEqual(h.count("control"), 1)
        self.assertEqual(page.locator(".status").count(), 0)
        self.assertEqual(h.announced(), "")
        h.assert_clean(allow_network=True)

    # 6
    def test_06_cors_fails_but_site_answers(self):
        h = self.h()
        h.set_plan(hub=["abort", 200])          # the cors try fails, the no-cors try gets an answer
        page = h.open()
        h.tick(25000)
        self.assertEqual([m for k, _, m in h.requests if k == "hub"], ["cors", "no-cors"])
        self.assertEqual(page.locator(".status").count(), 0)
        h.assert_clean(allow_network=True)

    # 7
    def test_07_signin_and_odd_answers(self):
        for status in (401, 403, 405, 429):
            with self.subTest(status=status):
                h = self.h()
                h.set_plan(hiring=status, voting=status, hub=status)
                page = h.open()
                h.tick(25000)
                self.assertEqual(h.checks(), len(CHECKED))
                self.assertEqual(page.locator(".status").count(), 0)
                h.assert_clean(allow_network=True)
                h.close()

    # 8
    def test_08_no_answer(self):
        h = self.h()
        h.set_plan(voting="hang")
        page = h.open()
        h.tick(12000)
        self.assertEqual(page.locator(".status").count(), 0)   # first timeout only: no warning yet
        h.tick(12000)
        self.assertEqual(h.count("voting"), 2)
        self.assertEqual(h.statuses(), ["Motion Voting"])
        h.assert_clean(allow_network=True)

    # 9
    def test_09_two_problems(self):
        h = self.h()
        h.set_plan(hiring=404, hub=503)
        page = h.open()
        h.tick(25000)
        self.assertEqual(h.statuses(), ["Physician Hiring", "Patient Hub"])
        self.assertEqual(h.announced(), "2 tools are not loading right now: Physician Hiring, Patient Hub.")
        # Each "Report it" has its own accessible name (WCAG 2.4.9). Playwright puts a space
        # before the hidden suffix because that span is positioned; screen readers vary too.
        for name in ("Physician Hiring", "Patient Hub"):
            link = page.get_by_role("link", name=re.compile(r"^Report it ?: %s is not loading$" % name))
            self.assertEqual(link.count(), 1, name)
        self.assertEqual(page.get_by_role("link", name=re.compile(r"^Report it")).count(), 2)
        h.assert_clean(allow_network=True)

    # 10
    def test_10_notice(self):
        tools = tools_json()
        tool(tools, "Patient Hub")["notice"] = "Closed for updates until Friday 3 pm."
        h = self.h(tools=tools)
        h.set_plan(hiring="abort", voting="abort", hub="abort", control="abort")
        page = h.open()
        note = page.locator(".card .note")
        self.assertEqual(note.count(), 1)
        self.assertEqual(note.text_content().strip(), "Note: Closed for updates until Friday 3 pm.")
        self.assertEqual(note.locator(".sr-only").text_content(), "Note: ")
        self.assertFalse(note.locator(".sr-only").is_visible() and note.locator(".sr-only").bounding_box()["width"] > 1)
        main = page.locator('.card:has(.note) .main')
        self.assertEqual(main.text_content(), "Patient Hub")
        self.assertIn(note.get_attribute("id"), main.get_attribute("aria-describedby").split())
        self.assertEqual(h.checks(), 0)                  # shown at once, before any check
        h.close()
        for until, shown in (("2026-10-15", False), ("2026-10-16", True), ("16 Oct", True)):
            with self.subTest(until=until):
                tool(tools, "Patient Hub")["notice_until"] = until
                h = self.h(tools=tools)
                page = h.open()
                self.assertEqual(page.locator(".card .note").count(), 1 if shown else 0)
                main = page.locator('.card .main', has_text="Patient Hub")
                self.assertEqual(main.get_attribute("aria-describedby") is not None, shown)
                h.assert_clean()
                h.close()

    # 11
    def test_11_broken_tools_json(self):
        h = self.h(tools_body='[{"name": "ED Hub",}')
        page = h.open(wait_tiles=False)
        page.wait_for_selector("#tools > .error")
        self.assertEqual(page.text_content("#tools > .error"),
                         "The tool list could not be loaded. Here are the main links. Please refresh the page later.")
        plain = page.locator("#tools > .plain")
        self.assertTrue(plain.is_visible())
        self.assertEqual(plain.evaluate("e => getComputedStyle(e).visibility"), "visible")
        links = page.eval_on_selector_all("#tools > .plain a", "els => els.map(a => [a.textContent, a.getAttribute('href')])")
        self.assertEqual([tuple(x) for x in links], check_tools.fallback_items(tools_json()))
        self.assertEqual(page.locator("#tools .card").count(), 0)
        h.assert_clean()

    # 12
    def test_12_entry_without_url(self):
        tools = tools_json()
        del tool(tools, "CPOE Order Review")["url"]
        h = self.h(tools=tools)
        page = h.open()
        self.assertEqual(page.locator("#tools .card").count(), len(FIXTURE) - 1)
        self.assertEqual(page.locator(".main", has_text="CPOE Order Review").count(), 0)
        self.assertEqual(len(h.warnings), 1, h.warnings)
        h.assert_clean()

    # 13
    def test_13_javascript_off(self):
        h = self.h(js=False)
        page = h.open(wait_tiles=False)
        plain = page.locator("#tools > .plain")
        self.assertTrue(plain.is_visible())
        self.assertTrue(page.get_by_role("link", name="Patient Hub: Editing guide").is_visible())
        self.assertEqual(page.locator("#tools > .plain a").count(), len(check_tools.fallback_items(tools_json())))
        report = page.locator("#report-link")
        self.assertTrue(report.is_visible())
        self.assertTrue(report.get_attribute("href").startswith("mailto:" + ADDRESS + "?subject=%5BED%20tools%5D"))
        self.assertTrue(page.get_by_role("link", name="About these tools").is_visible())
        self.assertIn(ADDRESS, page.text_content(".foot-address"))
        h.assert_clean()

    def _app_never_runs(self, app_js, allow):
        h = self.h(app_js=app_js)
        page = h.open(wait_tiles=False)
        plain = page.locator("#tools > .plain")
        style = plain.evaluate("e => [getComputedStyle(e).visibility, getComputedStyle(e).animationDelay]")
        self.assertEqual(style, ["hidden", "4s"])
        self.assertFalse(page.evaluate("document.getElementById('tools').classList.contains('app-running')"))
        page.evaluate("document.getAnimations().forEach(a => a.finish())")
        self.assertEqual(plain.evaluate("e => getComputedStyle(e).visibility"), "visible")
        self.assertTrue(plain.is_visible())
        h.assert_clean(allow=allow)

    # 13a
    def test_13a_app_js_syntax_error(self):
        self._app_never_runs("const broken = ;\n", allow=("SyntaxError", "Unexpected token", "Unexpected"))

    # 13b
    def test_13b_app_js_missing(self):
        self._app_never_runs(404, allow=NETWORK_NOISE + ("MIME type", "app.js"))

    # 13c
    def test_13c_slow_tools_json(self):
        h = self.h(clock=False, tools_get="hold", poll=True)
        page = h.open(wait_tiles=False)
        h.wait_until(lambda: h.held["tools"], "the tools.json request")
        for _ in range(6):                                   # about 6 s of real time
            state = page.evaluate("""() => { const t = document.getElementById('tools'); const p = t.querySelector('.plain');
                return [t.classList.contains('app-running'), getComputedStyle(p).visibility,
                        p.getAnimations().map(a => a.playState).join()]; }""")
            self.assertEqual(state, [True, "hidden", "paused"])
            page.wait_for_timeout(1000)
        h.release_tools()
        page.wait_for_selector("#tools .card")
        self.assertFalse(page.evaluate("window.__plainEverVisible"))
        h.assert_clean()

    # 13d
    def test_13d_hung_tools_json(self):
        h = self.h(tools_get="hang")
        page = h.open(wait_tiles=False)
        h.wait_until(lambda: h.hung, "the tools.json request")
        h.tick(9000)
        self.assertEqual(page.locator("#tools > .error").count(), 0)
        h.tick(1500)
        page.wait_for_selector("#tools > .error")
        self.assertTrue(page.locator("#tools > .plain").is_visible())
        h.tick(30000)
        self.assertTrue(page.locator("#tools > .plain").is_visible())
        self.assertEqual(page.locator("#tools > .error").count(), 1)
        h.assert_clean(allow_network=True)

    # 14
    def test_14_old_index_without_report_link(self):
        html = (REPO / "index.html").read_text()
        html, n = re.subn(r'<a id="report-link"[^>]*>Report a problem</a>', "", html)
        self.assertEqual(n, 1)
        h = self.h(index_html=html)
        h.set_plan(hiring=404)
        page = h.open()
        h.tick(25000)
        self.assertEqual(h.statuses(), ["Physician Hiring"])
        self.assertEqual(page.locator(".status-report").count(), 0)
        h.assert_clean(allow_network=True)

    # 15
    def test_15_back_button_recheck(self):
        h = self.h()
        h.set_plan(hiring=404)
        page = h.open()
        h.tick(25000)
        self.assertEqual(h.statuses(), ["Physician Hiring"])
        before = h.checks()
        h.set_plan(hiring=200)
        fire = "window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))"
        h.tick(60000, step=5000)                             # 1 minute later: too soon, nothing happens
        page.evaluate(fire)
        h.tick(3000)
        self.assertEqual((h.checks(), h.statuses()), (before, ["Physician Hiring"]))
        page.clock.run_for(6 * 60 * 1000)                    # more than 5 minutes after the last check
        page.evaluate(fire)
        self.assertEqual(h.statuses(), ["Physician Hiring"])  # kept until the new answer arrives
        h.tick(25000)
        self.assertEqual(h.checks(), before + len(CHECKED))
        self.assertEqual(page.locator(".status").count(), 0)  # recovered: mark replaced by nothing
        self.assertEqual(h.announced(), "")
        main = page.locator(".main", has_text="Physician Hiring")
        self.assertIsNone(main.get_attribute("aria-describedby"))
        h.assert_clean(allow_network=True)

    # 15a
    def test_15a_hidden_at_load(self):
        h = self.h(hidden=True)
        h.open()
        h.tick(30000)
        self.assertEqual(h.checks(), 0)
        h.page.evaluate("window.__setVis('visible')")
        h.tick(900)
        self.assertEqual(h.checks(), 0)
        h.tick(300)
        self.assertEqual(h.checks(), len(CHECKED))
        h.assert_clean()

    def _hidden_during_run(self, visible_before_end):
        h = self.h()
        h.set_plan(hiring=["hold", "abort"], voting=["hold", "abort"], hub=["hold", "abort"], control="hold")
        page = h.open()
        h.tick(1000)
        h.wait_until(lambda: all(h.held[k] for k in ("hiring", "voting", "hub")), "the first checks")
        page.evaluate("window.__setVis('hidden')")
        for k in ("hiring", "voting", "hub"):
            h.release(k, "abort")                            # every check fails while hidden
        h.tick(6000)                                         # the retry, also failing
        h.wait_until(lambda: h.held["control"], "the device-online request")
        first_run = h.checks()
        self.assertEqual(first_run, len(CHECKED) * 4)        # each tool: (cors + no-cors) x 2 tries
        h.set_plan(hiring=200, voting=200, hub=200)
        if visible_before_end:
            page.evaluate("window.__setVis('visible')")
            h.release("control", 200)                        # run ends: discarded
            h.tick(900)
            self.assertEqual(h.checks(), first_run)
            h.tick(300)                                      # about 1 s after the discard
            self.assertEqual(h.checks(), first_run + len(CHECKED))
        else:
            h.release("control", 200)                        # run ends while still hidden: discarded
            h.tick(30000)
            self.assertEqual(h.checks(), first_run)          # nothing until the page is visible
            page.evaluate("window.__setVis('visible')")
            h.tick(1200)
            self.assertEqual(h.checks(), first_run + len(CHECKED))
        h.tick(25000)
        self.assertEqual(page.locator(".status").count(), 0)
        self.assertEqual(h.announced(), "")
        h.assert_clean(allow_network=True)

    # 15b
    def test_15b_hidden_during_run_visible_again(self):
        self._hidden_during_run(True)

    def test_15b_hidden_during_run_still_hidden(self):
        self._hidden_during_run(False)

    # real data: the real tools.json and index.html load with no errors
    def test_00_real_tools_json(self):
        real = json.loads((REPO / "tools.json").read_text())
        usable = [t for t in real if isinstance(t, dict) and str(t.get("url", "")).startswith("https://")]
        h = self.h(real=True)
        page = h.open()
        self.assertEqual(page.locator("#tools .card").count(), len(usable))
        h.tick(25000)
        self.assertEqual(page.locator(".status").count(), 0)
        h.assert_clean()

    # review m1: app.js arrives after the list has already appeared (slow phone network)
    def test_13e_late_app_js_keeps_list_shown(self):
        h = self.h(clock=False, app_get="hold", tools_get="hold", poll=True)
        page = h.open(wait_tiles=False, wait_until="commit")    # "load" waits for the held app.js
        h.wait_until(lambda: h.held["app"], "the app.js request")
        page.wait_for_timeout(4800)                          # about 4.8 s of real time
        plain = page.locator("#tools > .plain")
        self.assertEqual(plain.evaluate("e => getComputedStyle(e).visibility"), "visible")
        h.release_app()
        h.wait_until(lambda: h.held["tools"], "the tools.json request")
        self.assertTrue(page.evaluate("document.getElementById('tools').classList.contains('app-running')"))
        page.wait_for_timeout(500)
        self.assertEqual(plain.evaluate("e => getComputedStyle(e).visibility"), "visible")
        h.release_tools()
        page.wait_for_selector("#tools .card")
        self.assertFalse(page.evaluate("window.__plainHiddenAgain"), "the list was hidden again before the tiles came")
        h.assert_clean()

    # review m2: the online check answers with an error page; the device is still online
    def test_05a_control_answers_503(self):
        h = self.h()
        h.set_plan(hiring=503, voting=503, control=503)
        h.open()
        h.tick(25000)
        self.assertEqual(h.count("control"), 1)
        self.assertEqual(h.statuses(), ["Motion Voting", "Physician Hiring"])
        h.assert_clean(allow_network=True)

    # review m3: brought back to the front after more than 5 minutes: ask again
    def test_15c_visible_again_after_five_minutes(self):
        h = self.h()
        h.set_plan(hiring=404)
        page = h.open()
        h.tick(25000)
        self.assertEqual(h.statuses(), ["Physician Hiring"])
        before = h.checks()
        h.set_plan(hiring=200)
        page.evaluate("window.__setVis('hidden')")
        page.evaluate("window.__setVis('visible')")          # back within 5 minutes: nothing
        h.tick(3000)
        self.assertEqual((h.checks(), h.statuses()), (before, ["Physician Hiring"]))
        page.evaluate("window.__setVis('hidden')")
        page.clock.run_for(6 * 60 * 1000)
        self.assertEqual(h.checks(), before)                 # no polling while away
        page.evaluate("window.__setVis('visible')")
        self.assertEqual(h.statuses(), ["Physician Hiring"])  # kept until the new answer arrives
        h.tick(25000)
        self.assertEqual(h.checks(), before + len(CHECKED))
        self.assertEqual(page.locator(".status").count(), 0)
        h.assert_clean(allow_network=True)

    # review m4: offline when the page opens: check once the device is back online
    def test_15d_offline_then_online(self):
        h = self.h(online=False)
        page = h.open()
        h.tick(30000)
        self.assertEqual(h.checks(), 0)
        page.evaluate("window.__setOnline(true)")
        h.tick(1200)
        self.assertEqual(h.checks(), len(CHECKED))
        page.evaluate("window.__setOnline(false)")
        page.evaluate("window.__setOnline(true)")            # the listener ran once; no second run
        h.tick(5000)
        self.assertEqual(h.checks(), len(CHECKED))
        h.assert_clean()

    # leftover 2: notice_until counts in Toronto, whatever zone the device is set to
    def test_10a_notice_until_uses_toronto_date(self):
        tools = tools_json()
        hub = tool(tools, "Patient Hub")
        hub["notice"] = "Closed for updates until Friday 3 pm."
        hub["notice_until"] = "2026-10-16"
        cases = [
            # 23:30 Oct 16 in Toronto is Oct 17 in Tokyo: still Oct 16 in Toronto, so shown
            ("Asia/Tokyo", "2026-10-16T23:30:00-04:00", True),
            # 00:30 Oct 17 in Toronto is still Oct 16 in Honolulu: over in Toronto, so hidden
            ("Pacific/Honolulu", "2026-10-17T00:30:00-04:00", False),
        ]
        for zone, when, shown in cases:
            with self.subTest(zone=zone):
                h = self.h(tools=tools, timezone=zone, clock_time=when)
                page = h.open()
                self.assertEqual(page.locator(".card .note").count(), 1 if shown else 0)
                h.assert_clean()
                h.close()

    # leftover 3: a tool that is still down keeps its warning through the recheck
    def test_15e_recheck_keeps_warning_while_still_down(self):
        h = self.h()
        h.set_plan(hiring=404)
        page = h.open()
        h.tick(25000)
        self.assertEqual(h.statuses(), ["Physician Hiring"])
        pill_id = page.locator(".status .ed-pill").get_attribute("id")
        page.evaluate("document.querySelector('.status').dataset.first = 'yes'")
        said = h.announced()
        before = h.checks()
        page.clock.run_for(6 * 60 * 1000)
        page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))")
        for _ in range(25):                                  # through the whole recheck, second by second
            h.tick(1000)
            self.assertEqual(h.statuses(), ["Physician Hiring"])
        self.assertEqual(h.checks(), before + len(CHECKED) + 1)     # hiring asked twice (retry)
        self.assertEqual(page.locator(".status").get_attribute("data-first"), "yes")   # the same mark, kept
        main = page.locator(".main", has_text="Physician Hiring")
        self.assertEqual(main.get_attribute("aria-describedby").split().count(pill_id), 1)
        self.assertEqual(h.announced(), said)                 # nothing new to say
        h.assert_clean(allow_network=True)

    # leftover 3: a second tool going down during the recheck is added and announced
    def test_15f_recheck_adds_new_problem(self):
        h = self.h()
        h.set_plan(hiring=404)
        page = h.open()
        h.tick(25000)
        h.set_plan(hub=503)
        page.clock.run_for(6 * 60 * 1000)
        page.evaluate("window.__setVis('hidden')")
        page.evaluate("window.__setVis('visible')")
        h.tick(25000)
        self.assertEqual(h.statuses(), ["Physician Hiring", "Patient Hub"])
        self.assertEqual(h.announced(), "2 tools are not loading right now: Physician Hiring, Patient Hub.")
        h.assert_clean(allow_network=True)

    # review: when fewer tools are down than before, the hidden announcement must not keep the old sentence
    def test_15h_recheck_fewer_problems_clears_old_announcement(self):
        h = self.h()
        h.set_plan(hiring=404, hub=503)
        page = h.open()
        h.tick(25000)
        self.assertEqual(h.statuses(), ["Physician Hiring", "Patient Hub"])
        self.assertEqual(h.announced(), "2 tools are not loading right now: Physician Hiring, Patient Hub.")
        h.set_plan(hub=200)
        page.clock.run_for(6 * 60 * 1000)
        page.evaluate("window.__setVis('hidden')")
        page.evaluate("window.__setVis('visible')")
        h.tick(25000)
        self.assertEqual(h.statuses(), ["Physician Hiring"])
        self.assertEqual(h.announced(), "")
        h.assert_clean(allow_network=True)

    # leftover 4: offline at the online check: try again when the device is back online
    def test_15g_offline_at_online_check(self):
        h = self.h()
        h.set_plan(hiring=404)
        page = h.open()
        h.tick(1000)                                         # first try fails
        h.wait_until(lambda: h.count("hiring") >= 1, "the first hiring check")
        page.evaluate("window.__online = false")             # the device drops off during the retry wait
        h.tick(25000)
        self.assertEqual(h.count("hiring"), 2)
        self.assertEqual(h.count("control"), 0)              # navigator.onLine said offline: no request
        self.assertEqual(page.locator(".status").count(), 0)
        before = h.checks()
        h.tick(30000)
        self.assertEqual(h.checks(), before)                 # nothing until it is back online
        page.evaluate("window.__setOnline(true)")
        h.tick(25000)
        self.assertEqual(h.checks(), before + len(CHECKED) + 1)
        self.assertEqual(h.statuses(), ["Physician Hiring"])
        page.evaluate("window.__setOnline(false)")
        page.evaluate("window.__setOnline(true)")            # one listener only: no extra round
        h.tick(5000)
        self.assertEqual(h.checks(), before + len(CHECKED) + 1)
        h.assert_clean(allow_network=True)

    # review m5: a related link that is not https:// is skipped, like a bad tool
    def test_12a_bad_related_link(self):
        tools = tools_json()
        hub = tool(tools, "Patient Hub")
        hub["related"]["links"].append({"name": "Bad", "url": "javascript:alert(1)"})
        voting = tool(tools, "Motion Voting")
        voting["related"]["links"] = [{"name": "Plain http", "url": "http://example.org/"}]
        h = self.h(tools=tools)
        page = h.open()
        self.assertEqual(page.locator(".related-links a", has_text="Bad").count(), 0)
        self.assertEqual(page.locator('.related-links a[href^="javascript:"]').count(), 0)
        self.assertEqual(page.locator(".related-links a").count(), len(tool(FIXTURE, "Patient Hub")["related"]["links"]))
        voting_card = page.locator(".card", has=page.locator(".main", has_text="Motion Voting"))
        self.assertEqual(voting_card.locator(".related").count(), 0)   # no links left: no block
        self.assertEqual(len(h.warnings), 2, h.warnings)
        h.assert_clean()

    # The label is optional (2026-10-18): without one the links show on their own, no heading.
    def test_12b_related_without_label(self):
        tools = tools_json()
        hub = tool(tools, "Patient Hub")
        del hub["related"]["label"]
        h = self.h(tools=tools)
        page = h.open()
        card = page.locator(".card", has=page.locator(".main", has_text="Patient Hub"))
        self.assertEqual(card.locator(".related-head").count(), 0)
        self.assertEqual(card.locator(".related-links a").count(), len(hub["related"]["links"]))
        self.assertEqual(card.locator(".related-links").get_attribute("aria-label"), "Patient Hub links")
        voting = page.locator(".card", has=page.locator(".main", has_text="Motion Voting"))
        self.assertEqual(voting.locator(".related-head").count(), 1)   # a label still shows when given
        h.assert_clean()

    # review m6: what counts as a problem
    def test_07a_answers_that_mean_a_problem(self):
        for status in (410, 500, 502, 503):
            with self.subTest(status=status):
                h = self.h()
                h.set_plan(hub=status)
                h.open()
                h.tick(25000)
                self.assertEqual(h.statuses(), ["Patient Hub"])
                h.assert_clean(allow_network=True)
                h.close()

    def test_07b_hub_200_without_cors_header(self):
        # Patient Hub answers 200 but without access-control-allow-origin. Playwright's
        # own answers skip the browser's CORS rule, so this proves only that the page
        # adds no warning for a 200; the real "CORS refused, site up" path (the cors
        # try fails, the no-cors try answers) is test 6.
        h = self.h()
        h.set_plan(hub="200-no-acao")
        page = h.open()
        h.tick(25000)
        self.assertEqual(h.count("hub"), 1)
        self.assertEqual(page.locator(".status").count(), 0)
        h.assert_clean()

    # 16
    def test_16_phone_layout(self):
        tools = tools_json()
        tool(tools, "Physician Hiring")["notice"] = LONG_NOTICE
        big = ".ed-pill, .status-report { font-size: 26px !important; } .note { font-size: 30px !important; }"
        for width in (320, 375):
            for scheme in ("light", "dark"):
                with self.subTest(width=width, scheme=scheme):
                    h = self.h(tools=tools, viewport=(width, 800), color_scheme=scheme)
                    h.set_plan(hiring=404)
                    page = h.open()
                    h.tick(25000)
                    self.assertEqual(h.statuses(), ["Physician Hiring"])
                    for size in ("normal", "double"):
                        if size == "double":
                            page.add_style_tag(content=big)
                        res = page.evaluate("""() => {
                          const doc = document.documentElement;
                          const card = document.querySelector('.card:has(.status)');
                          const box = card.querySelector('.card-text').getBoundingClientRect();
                          const out = { scroll: doc.scrollWidth - doc.clientWidth, over: [] };
                          for (const sel of ['.ed-pill', '.status-report', '.note']) {
                            const r = card.querySelector(sel).getBoundingClientRect();
                            if (r.right > box.right + 0.5 || r.left < box.left - 0.5) out.over.push(sel + ' ' + r.right + ' > ' + box.right);
                          }
                          return out; }""")
                        self.assertLessEqual(res["scroll"], 0, size)
                        self.assertEqual(res["over"], [], size)
                    h.assert_clean(allow_network=True)
                    h.close()

    # 17
    def test_17_axe(self):
        if not AXE.is_file():
            self.skipTest("axe-core not found at %s" % AXE)
        tools = tools_json()
        tool(tools, "Patient Hub")["notice"] = "Closed for updates until Friday 3 pm."
        for scheme in ("light", "dark"):
            with self.subTest(scheme=scheme):
                h = self.h(tools=tools, color_scheme=scheme)
                h.set_plan(hiring=404)
                page = h.open()
                h.tick(25000)
                self.assertEqual(h.statuses(), ["Physician Hiring"])
                page.clock.resume()
                page.add_script_tag(content=AXE.read_text())
                result = page.evaluate("""async () => {
                  const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21aa', 'wcag22aa'] } });
                  return r.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).join(', '));
                }""")
                self.assertEqual(result, [], scheme)
                h.assert_clean(allow_network=True)
                h.close()


_wanted = [b.strip() for b in os.environ.get("DASHBOARD_BROWSERS", "chromium,webkit").split(",") if b.strip()]
for _name in _wanted:
    _cls = type("TestPage" + _name.capitalize(), (PageTests, unittest.TestCase), {"BROWSER": _name})
    globals()[_cls.__name__] = _cls
del _cls, _name


BG = {"light": "rgb(245, 245, 247)", "dark": "rgb(0, 0, 0)"}       # --ed-bg
BAR = {"light": "#f5f5f7", "dark": "#000000"}                      # theme-color
LOOK = """() => ({ attr: document.documentElement.getAttribute('data-theme'),
  bg: getComputedStyle(document.body).backgroundColor,
  pressed: document.querySelector('.theme-toggle').getAttribute('aria-pressed'),
  title: document.querySelector('.theme-toggle').title,
  shown: getComputedStyle(document.querySelector('.theme-toggle')).display !== 'none',
  bars: [...document.querySelectorAll('meta[name=theme-color]')].map(m => m.content),
  saved: (() => { try { return localStorage.getItem('ed_theme'); } catch (e) { return 'blocked'; } })() })"""


class ThemeSwitch:
    """The light/dark switch beside the gear (theme.js, theme.css)."""
    BROWSER = "chromium"

    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = getattr(cls.pw, cls.BROWSER).launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def test_switch_flips_remembers_and_goes_back_to_the_device(self):
        for device, other in (("light", "dark"), ("dark", "light")):
            with self.subTest(device=device):
                h = Harness(self, self.browser, color_scheme=device)
                page = h.open()
                s = page.evaluate(LOOK)
                self.assertEqual((s["attr"], s["bg"], s["saved"]), (None, BG[device], None))
                self.assertTrue(s["shown"])
                self.assertEqual(s["pressed"], "true" if device == "dark" else "false")
                self.assertEqual(s["title"], "Switch to %s mode" % other)
                page.click(".theme-toggle")
                s = page.evaluate(LOOK)
                self.assertEqual((s["attr"], s["bg"], s["saved"]), (other, BG[other], other))
                self.assertEqual(s["pressed"], "true" if other == "dark" else "false")
                self.assertEqual(s["title"], "Switch to %s mode" % device)
                self.assertEqual(s["bars"], [BAR[other], BAR[other]])
                page.reload()
                page.wait_for_selector("#tools .card")
                s = page.evaluate(LOOK)
                self.assertEqual((s["attr"], s["bg"]), (other, BG[other]), "the choice is remembered")
                page.click(".theme-toggle")
                s = page.evaluate(LOOK)
                self.assertEqual((s["attr"], s["bg"], s["saved"]), (None, BG[device], None),
                                 "picking the device's own look follows the device again")
                self.assertEqual(s["bars"], ["#f5f5f7", "#000000"])
                h.assert_clean()
                h.close()

    def test_choice_stays_when_the_device_changes(self):
        h = Harness(self, self.browser, color_scheme="light")
        page = h.open()
        page.click(".theme-toggle")
        self.assertEqual(page.evaluate(LOOK)["saved"], "dark")
        page.emulate_media(color_scheme="dark")      # sunset: the device turns dark too
        page.wait_for_timeout(50)
        s = page.evaluate(LOOK)
        self.assertEqual((s["attr"], s["bg"], s["saved"], s["pressed"]), ("dark", BG["dark"], "dark", "true"))
        page.emulate_media(color_scheme="light")     # sunrise: the person's choice still holds
        page.wait_for_timeout(50)
        s = page.evaluate(LOOK)
        self.assertEqual((s["attr"], s["bg"], s["saved"]), ("dark", BG["dark"], "dark"), "the choice is kept")
        page.reload()
        page.wait_for_selector("#tools .card")
        self.assertEqual(page.evaluate(LOOK)["bg"], BG["dark"])
        h.assert_clean()

    def test_storage_blocked_still_switches(self):
        h = Harness(self, self.browser, color_scheme="light")
        h.ctx.add_init_script("Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });")
        page = h.open()
        page.click(".theme-toggle")
        s = page.evaluate(LOOK)
        self.assertEqual((s["attr"], s["bg"], s["saved"]), ("dark", BG["dark"], "blocked"))
        page.click(".theme-toggle")
        self.assertEqual(page.evaluate(LOOK)["bg"], BG["light"])
        h.assert_clean()

    def test_hidden_without_javascript(self):
        h = Harness(self, self.browser, js=False)
        page = h.open(wait_tiles=False)
        self.assertFalse(page.locator(".theme-toggle").is_visible())
        self.assertTrue(page.locator(".settings-link").is_visible())
        h.close()

    def test_phone_header_fits(self):
        for width in (320, 375):
            with self.subTest(width=width):
                h = Harness(self, self.browser, viewport=(width, 800))
                page = h.open()
                r = page.evaluate("""() => {
                  const b = document.querySelector('.theme-toggle').getBoundingClientRect();
                  const g = document.querySelector('.settings-link').getBoundingClientRect();
                  const doc = document.documentElement;
                  return { scroll: doc.scrollWidth - doc.clientWidth, bw: b.width, bh: b.height,
                           gap: g.left - b.right, sameRow: Math.abs(b.top - g.top) < 1 }; }""")
                self.assertLessEqual(r["scroll"], 0)
                self.assertGreaterEqual(min(r["bw"], r["bh"]), 44)
                self.assertGreaterEqual(r["gap"], 0)
                self.assertTrue(r["sameRow"])
                h.close()

    def test_passwords_and_404_pages_follow_the_choice(self):
        h = Harness(self, self.browser, color_scheme="light")
        page = h.open()
        page.click(".theme-toggle")
        for path in ("/passwords.html", "/no-such-page"):
            with self.subTest(path=path):
                body = (REPO / ("passwords.html" if path == "/passwords.html" else "404.html")).read_bytes()

                def serve(route, request=None, body=body):
                    route.fulfill(status=200, body=body, headers={"content-type": TYPES[".html"]})
                h.ctx.route(SITE + path, serve)
                page.goto(SITE + path, wait_until="domcontentloaded")
                self.assertEqual(page.evaluate("document.documentElement.getAttribute('data-theme')"), "dark")
                self.assertEqual(page.evaluate("getComputedStyle(document.body).backgroundColor"), BG["dark"])
        h.close()


for _name in _wanted:
    _cls = type("TestTheme" + _name.capitalize(), (ThemeSwitch, unittest.TestCase), {"BROWSER": _name})
    globals()[_cls.__name__] = _cls
del _cls, _name


# Replaces the browser's share sheet and clipboard, so a test decides what each does.
# share: "ok" (records what was shared), "cancel" (AbortError), "busy" (InvalidStateError:
# the menu is already open), "fail" (another error), "none" (no share menu, as Firefox).
# copy: "ok", "old" (no clipboard API; the old execCommand way works) or "fail" (both blocked).
SHARE_STUBS = """
(() => {
  const share = %s, copy = %s;
  window.__shared = []; window.__copied = [];
  if (share === "none") { delete Navigator.prototype.share; delete Navigator.prototype.canShare; }
  else Object.defineProperty(Navigator.prototype, "share", { configurable: true, value: async (d) => {
    window.__shared.push(d);
    if (share === "cancel") throw new DOMException("cancelled", "AbortError");
    if (share === "busy") throw new DOMException("already open", "InvalidStateError");
    if (share === "fail") throw new DOMException("not allowed", "NotAllowedError");
  } });
  Object.defineProperty(Navigator.prototype, "clipboard", { configurable: true, get: () => ({
    writeText: async (t) => { if (copy !== "ok") throw new Error("blocked"); window.__copied.push(t); } }) });
  document.execCommand = (cmd) => {
    if (copy !== "old" || cmd !== "copy") return false;
    const a = document.activeElement;
    window.__copied.push(a.value.slice(a.selectionStart, a.selectionEnd));
    return true;
  };
})();
"""


class ShareButton:
    """A share button on every tool row (app.js shareTool)."""
    BROWSER = "chromium"

    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = getattr(cls.pw, cls.BROWSER).launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def open(self, share, copy="ok", phone=True, **kw):
        if phone:
            kw.setdefault("viewport", (390, 800))
        h = Harness(self, self.browser, has_touch=phone, **kw)
        h.ctx.add_init_script(SHARE_STUBS % (json.dumps(share), json.dumps(copy)))
        h.touch = phone
        return h, h.open()

    def hiring(self, page):
        return page.locator('.card:has(.main:text("Physician Hiring")) .share')

    def press(self, h, page):
        """Press Physician Hiring's share button (a tap on a touch screen) and let the 50 ms message delay pass."""
        b = self.hiring(page)
        b.tap() if h.touch else b.click()
        h.tick(100, step=50)

    def message(self, page):
        t = page.locator("#share-toast")
        return t.text_content() if page.locator("#share-toast.show").count() else None

    def test_every_row_has_one_named_share_button(self):
        h, page = self.open("ok", phone=False)
        names = page.eval_on_selector_all(".card", "cs => cs.map(c => [c.querySelector('.main').textContent, "
                                          "c.querySelectorAll('.share').length, c.querySelector('.share').getAttribute('aria-label'), "
                                          "c.querySelector('.share').title, c.querySelector('.share').type])")
        self.assertEqual(len(names), len(FIXTURE))
        for name, count, label, title, kind in names:
            self.assertEqual((count, label, title, kind), (1, "Share " + name, "Share link", "button"))
        t = page.locator("#share-toast")
        self.assertEqual((t.get_attribute("role"), t.text_content()), ("status", ""), "the message box waits empty")
        h.assert_clean()

    def test_phone_share_menu_gets_the_main_address(self):
        h, page = self.open("ok")
        self.press(h, page)
        self.assertEqual(page.evaluate("window.__shared"),
                         [{"title": "Physician Hiring", "url": tool(FIXTURE, "Physician Hiring")["url"]}])
        self.assertEqual(page.url, SITE + "/", "the share button does not open the tool")
        self.assertEqual((page.evaluate("window.__copied"), self.message(page)), ([], None))
        h.assert_clean()

    def test_phone_cancel_or_menu_already_open_does_nothing(self):
        for share in ("cancel", "busy"):
            with self.subTest(share=share):
                h, page = self.open(share)
                self.press(h, page)
                self.assertEqual(len(page.evaluate("window.__shared")), 1)
                self.assertEqual((page.evaluate("window.__copied"), self.message(page), page.url), ([], None, SITE + "/"))
                h.assert_clean()
                h.close()

    def test_phone_share_error_copies_instead(self):
        h, page = self.open("fail")
        self.press(h, page)
        self.assertEqual(page.evaluate("window.__copied"), [tool(FIXTURE, "Physician Hiring")["url"]])
        self.assertEqual(self.message(page), "Link copied")
        h.assert_clean()

    def test_computer_copies_even_with_a_share_menu(self):
        for share in ("ok", "none"):
            with self.subTest(share=share):
                h, page = self.open(share, phone=False)
                self.press(h, page)
                self.assertEqual(page.evaluate("window.__shared"), [])
                self.assertEqual(page.evaluate("window.__copied"), [tool(FIXTURE, "Physician Hiring")["url"]])
                self.assertEqual(self.message(page), "Link copied")
                h.tick(3000)
                self.assertEqual(self.message(page), None, "the message goes away")
                self.press(h, page)
                self.assertEqual(self.message(page), "Link copied", "a second press says it again")
                h.assert_clean()
                h.close()

    def test_old_way_copy_keeps_the_place_and_focus(self):
        h, page = self.open("none", copy="old", phone=False, viewport=(1024, 400))
        page.evaluate("window.scrollTo(0, 120)")
        self.hiring(page).focus()
        y = page.evaluate("window.scrollY")
        page.keyboard.press("Enter")
        h.tick(100, step=50)
        self.assertEqual(page.evaluate("window.__copied"), [tool(FIXTURE, "Physician Hiring")["url"]])
        self.assertEqual(page.evaluate("window.scrollY"), y, "the page does not jump")
        self.assertEqual(page.evaluate("document.activeElement.getAttribute('aria-label')"), "Share Physician Hiring")
        self.assertEqual(page.locator("textarea").count(), 0)
        self.assertEqual(self.message(page), "Link copied")
        h.assert_clean()

    def test_copy_blocked_opens_an_email(self):
        h, page = self.open("none", copy="fail", phone=False)
        page.evaluate("""() => { window.__mail = null;
          document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a[href^="mailto:"]');
            if (a) { window.__mail = a.href; e.preventDefault(); } }, true); }""")
        self.press(h, page)
        page.wait_for_function("window.__mail !== null")
        mail = page.evaluate("window.__mail")
        self.assertEqual(self.message(page), None)
        self.assertEqual(page.locator("body > a.sr-only").count(), 0, "the helper link is removed")
        self.assertTrue(mail.startswith("mailto:?subject=Physician%20Hiring&body="), mail)
        self.assertIn(urllib.parse.quote(tool(FIXTURE, "Physician Hiring")["url"], safe=""), mail)
        h.close()

    def test_phone_rows_fit_with_the_button(self):
        for width in (320, 375):
            with self.subTest(width=width):
                h, page = self.open("ok", viewport=(width, 800))
                r = page.evaluate("""() => {
                  const doc = document.documentElement, out = { scroll: doc.scrollWidth - doc.clientWidth, small: [], over: [] };
                  for (const c of document.querySelectorAll('.card')) {
                    const b = c.querySelector('.share').getBoundingClientRect(), row = c.querySelector('.card-row').getBoundingClientRect();
                    if (b.width < 44 || b.height < 44) out.small.push(b.width + 'x' + b.height);
                    if (b.right > row.right + 0.5) out.over.push(c.querySelector('.main').textContent);
                  }
                  return out; }""")
                self.assertEqual((r["scroll"], r["small"], r["over"]), (0, [], []))
                h.close()


for _name in _wanted:
    _cls = type("TestShare" + _name.capitalize(), (ShareButton, unittest.TestCase), {"BROWSER": _name})
    globals()[_cls.__name__] = _cls
del _cls, _name

class GearLink(unittest.TestCase):
    """Design B.7.2 (PR B): the gear opens the ED tools passwords page in this repo."""

    def test_gear_opens_the_passwords_page(self):
        root = Path(__file__).resolve().parent.parent
        index = (root / "index.html").read_text(encoding="utf-8")
        m = re.search(r'<a class="settings-link" href="([^"]+)"', index)
        self.assertIsNotNone(m, "the gear link is missing")
        self.assertEqual(m.group(1), "passwords.html")
        self.assertTrue((root / "passwords.html").is_file())


if __name__ == "__main__":
    unittest.main()
