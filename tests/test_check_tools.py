"""Tests for scripts/check_tools.py. Standard library only; no network.

Each test copies the dashboard into a temporary folder and changes the copy, so the
real files are never touched.

    python3 -m unittest discover -s tests -p 'test_check_tools.py'
"""

import contextlib
import datetime
import io
import json
import os
import re
import shutil
import socket
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))
import check_tools  # noqa: E402

SCOPE = ("For tool problems only. Not for medical questions. Please do not write names, "
         "health card numbers or health details.")
COPY = ["tools.json", "index.html", "404.html", "app.js", "README.md", "icons"]


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="dash-check-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        for name in COPY:
            src = REPO / name
            if src.is_dir():
                shutil.copytree(src, self.tmp / name)
            else:
                shutil.copy2(src, self.tmp / name)

    # helpers
    def tools(self):
        return json.loads((self.tmp / "tools.json").read_text())

    def save_tools(self, tools):
        (self.tmp / "tools.json").write_text(json.dumps(tools, indent=2, ensure_ascii=False))

    def edit(self, fn, i=0):
        tools = self.tools()
        fn(tools[i])
        self.save_tools(tools)

    def text(self, name):
        return (self.tmp / name).read_text()

    def write(self, name, text):
        (self.tmp / name).write_text(text)

    def run_check(self, **kw):
        return check_tools.run(self.tmp, **kw)

    def errors(self, **kw):
        report, _ = self.run_check(**kw)
        return [m for _, m in report.errors]

    def assertFails(self, *needles, **kw):
        errs = self.errors(**kw)
        self.assertTrue(errs, "expected a problem, got none")
        joined = "\n".join(errs)
        for n in needles:
            self.assertIn(n, joined)
        return errs

    def assertPasses(self, **kw):
        errs = self.errors(**kw)
        self.assertEqual(errs, [])

    def main_cli(self, *args, env=None):
        out = io.StringIO()
        with mock.patch.object(check_tools, "ROOT", self.tmp), \
                mock.patch.dict(os.environ, env or {}, clear=False), \
                contextlib.redirect_stdout(out):
            code = check_tools.main(list(args))
        return code, out.getvalue()


class TestRealRepo(Base):
    def test_01_real_repo_passes(self):
        report, count = check_tools.run(REPO)
        self.assertEqual(report.errors, [])
        self.assertEqual(count, 5)


class TestFileRules(Base):
    def test_02_broken_json(self):
        text = self.text("tools.json")
        broken = text.replace('"group": "For the ED team",', '"group": "For the ED team"', 1)
        self.write("tools.json", broken)
        errs = self.assertFails("not valid JSON at line", "column", "missing or extra comma")
        self.assertRegex(errs[0], r"line \d+, column \d+")

    def test_03_object_not_array(self):
        self.write("tools.json", json.dumps({"tools": self.tools()}))
        self.assertFails("must be a list of tools")

    def test_04_required_fields(self):
        for field in ["name", "group", "description", "url", "icon", "color", "owner"]:
            for bad in (None, "   "):
                with self.subTest(field=field, bad=bad):
                    self.setUp()
                    def change(t):
                        if bad is None:
                            del t[field]
                        else:
                            t[field] = bad
                    self.edit(change, 1)
                    errs = self.assertFails('"%s" is missing or empty' % field)
                    self.assertTrue(any(e.startswith("Tool 2") for e in errs), errs)

    def test_04b_lengths(self):
        self.edit(lambda t: t.update(description="x" * 91))
        self.assertFails('"description" is 91 characters long')

    def test_05_unknown_key(self):
        self.edit(lambda t: t.update(descripton="typo"))
        self.assertFails('"descripton" is not a known field', "Known fields: name, group, description, url, icon, "
                         "color, owner, repo, related, check, notice, notice_until.")

    def test_06_colors_from_app_js(self):
        self.edit(lambda t: t.update(color="purple"))
        self.assertFails('"color" is "purple". Use one of: blue, indigo, teal, green, orange, pink, red, gray.')
        app = self.text("app.js").replace('"gray"];', '"gray", "purple"];', 1)
        self.write("app.js", app)
        self.assertPasses()

    def test_07_url_rules(self):
        bad = ["http://example.org/", "https://", "https://exa mple.org/", "https://user@example.org/",
               "https://example.org/?token=x", "https://example.org/?Code=1", "https://localhost/x"]
        for url in bad:
            with self.subTest(url=url):
                self.setUp()
                self.edit(lambda t: t.update(url=url))
                self.assertFails("Tool 1")
        self.setUp()
        self.edit(lambda t: t.update(url="https://example.org/tool/?view=list"))
        self.assertPasses(allow_stale=True)
        self.setUp()
        def bad_related(t):
            t["related"]["links"][0]["url"] = "https://example.org/?password=1"
        self.edit(bad_related, 1)
        self.assertFails("Never put a password or code in a link")

    def test_08_icon_rules(self):
        cases = {
            "missing": ("icons/nope.svg", None, "does not exist"),
            "folder": ("img/ed-hub.svg", None, "must look like icons/"),
            "not svg": ("icons/apple-touch-icon.png", None, "must look like icons/"),
            "script": ("icons/t.svg", '<svg viewBox="0 0 24 24"><script>x</script></svg>', "contains a script"),
            "onload": ("icons/t.svg", '<svg viewBox="0 0 24 24" onload="x()"></svg>', "event attribute"),
            "href": ("icons/t.svg", '<svg viewBox="0 0 24 24"><image href="https://x.org/a.png"/></svg>', "loads something"),
            "xlink": ("icons/t.svg", '<svg viewBox="0 0 24 24"><use xlink:href="http://x.org/a.svg#a"/></svg>', "loads something"),
            "currentColor": ("icons/t.svg", '<svg viewBox="0 0 24 24" stroke="currentColor"></svg>', "uses currentColor"),
            "big": ("icons/t.svg", '<svg viewBox="0 0 24 24">' + " " * 11000 + "</svg>", "too big"),
            "not svg body": ("icons/t.svg", "<html></html>", "not an SVG drawing"),
        }
        for name, (path, body, needle) in cases.items():
            with self.subTest(name):
                self.setUp()
                if body is not None:
                    self.write(path, body)
                self.edit(lambda t: t.update(icon=path))
                self.assertFails(needle)
        # missing viewBox only warns
        self.setUp()
        self.write("icons/t.svg", '<?xml version="1.0"?>\n<svg stroke="#fff"></svg>')
        self.edit(lambda t: t.update(icon="icons/t.svg"))
        report, _ = self.run_check()
        self.assertEqual(report.errors, [])
        self.assertTrue(any("viewBox" in m for _, m in report.warnings))

    def test_09_duplicate_names(self):
        self.edit(lambda t: t.update(name="  motion voting "), 0)
        self.assertFails("has the same name as tool")

    def test_10_em_dash_and_notice(self):
        self.edit(lambda t: t.update(description="Resources — referrals"))
        self.assertFails("em dash")
        self.setUp()
        self.edit(lambda t: t.update(notice="Closed — back soon"))
        self.assertFails("em dash")
        self.setUp()
        self.edit(lambda t: t.update(notice="x" * 141))
        self.assertFails('"notice" is 141 characters long')
        self.setUp()
        self.edit(lambda t: t.update(notice="Use <b>this</b>"))
        self.assertFails("cannot contain < or >")
        self.setUp()
        self.edit(lambda t: t.update(notice="Closed for updates until Friday 3 pm."))
        self.assertPasses()

    def test_10a_notice_until(self):
        for bad in ("23/10/2026", "2026-02-30"):
            with self.subTest(bad=bad):
                self.setUp()
                self.edit(lambda t: t.update(notice="Planned work.", notice_until=bad))
                self.assertFails('"notice_until"')
        self.setUp()
        self.edit(lambda t: t.update(notice_until="2026-10-23"))
        self.assertFails('only works together with "notice"')

        def run_at(until, now):
            self.setUp()
            self.edit(lambda t: t.update(notice="Planned work.", notice_until=until))
            return self.run_check(now=now)[0]

        # a past date warns but passes
        r = run_at("2020-01-01", None)
        self.assertEqual(r.errors, [])
        self.assertTrue(any("the notice ended on 2020-01-01" in m for _, m in r.warnings))
        # a future date passes silently
        r = run_at("2099-01-01", None)
        self.assertEqual((r.errors, [m for _, m in r.warnings if "notice" in m]), ([], []))
        utc = datetime.timezone.utc
        # 2026-10-24 01:00 UTC is 21:00 on 2026-10-23 in Toronto: not over yet
        r = run_at("2026-10-23", datetime.datetime(2026, 10, 24, 1, 0, tzinfo=utc))
        self.assertFalse(any("notice ended" in m for _, m in r.warnings))
        # 2026-10-24 05:00 UTC is 01:00 on 2026-10-24 in Toronto: over
        r = run_at("2026-10-23", datetime.datetime(2026, 10, 24, 5, 0, tzinfo=utc))
        self.assertTrue(any("the notice ended on 2026-10-23" in m for _, m in r.warnings))

    def test_11_check_hosts(self):
        msg = ('"check" only works for addresses on michaelgarronhospital-ed.github.io or '
               'mgh-ed-patient-hub.pages.dev. Remove the line "check": true for this tool.')
        for url in ("https://tehn.sharepoint.com/sites/EDResourcesandReferralSupports",
                    "https://www.tehn.ca/EDPatientHub/"):
            with self.subTest(url=url):
                self.setUp()
                self.edit(lambda t: t.update(url=url, check=True))
                self.assertFails(msg)
        for url in ("https://michaelgarronhospital-ed.github.io/x/", "https://mgh-ed-patient-hub.pages.dev/"):
            with self.subTest(url=url):
                self.setUp()
                self.edit(lambda t: t.update(url=url, check=True))
                self.assertPasses(allow_stale=True)
        # read from app.js: add a host there and it passes
        self.setUp()
        app = self.text("app.js").replace('"mgh-ed-patient-hub.pages.dev"];', '"mgh-ed-patient-hub.pages.dev", "www.tehn.ca"];', 1)
        self.write("app.js", app)
        self.edit(lambda t: t.update(url="https://www.tehn.ca/EDPatientHub/", check=True))
        self.assertPasses(allow_stale=True)
        # check must be a real true/false
        self.setUp()
        self.edit(lambda t: t.update(check="true"))
        self.assertFails('"check" must be true')

    def test_12_contact(self):
        self.write("index.html", self.text("index.html").replace('id="report-link"', 'id="report"'))
        self.assertFails('exactly one "Report a problem" link')
        self.setUp()
        self.write("404.html", self.text("404.html").replace("mailto:MGHEmergencyDepartmentAdministration@tehn.ca",
                                                             "mailto:someone@example.org"))
        self.assertFails("404.html must have an email link to the same address")
        self.setUp()
        self.write("index.html", self.text("index.html").replace("subject=%5BED%20tools%5D%20Problem", "subject=Problem"))
        self.assertFails("must start with [ED tools]")
        self.setUp()
        self.write("404.html", self.text("404.html").replace("subject=%5BED%20tools%5D%20Broken", "subject=Broken"))
        self.assertFails("404.html: the report email subject must start with [ED tools]")
        # the real files: each decoded body ends with the scope and privacy sentence
        for name, pattern in (("index.html", r'id="report-link" href="([^"]+)"'),
                              ("404.html", r'href="(mailto:[^"]+)"')):
            href = re.search(pattern, (REPO / name).read_text()).group(1)
            addr, params = check_tools.mailto_parts(href)
            self.assertEqual(addr, "MGHEmergencyDepartmentAdministration@tehn.ca")
            body = urllib.parse.unquote(params["body"])
            self.assertTrue(body.endswith("\r\n\r\n" + SCOPE), (name, body))
            self.assertTrue(urllib.parse.unquote(params["subject"]).startswith("[ED tools] "))
        # the footer and app.js use the same sentence, word for word
        self.assertIn(" ".join(SCOPE.split()), " ".join((REPO / "index.html").read_text().split()))
        self.assertIn(SCOPE, (REPO / "app.js").read_text())


class TestFallback(Base):
    def block(self, text):
        s = text.index("<!-- tools-fallback:start")
        e = text.index("<!-- tools-fallback:end -->") + len("<!-- tools-fallback:end -->")
        return text[:s], text[s:e], text[e:]

    def test_13_drift_and_write(self):
        before = self.text("index.html")
        self.edit(lambda t: t.update(name="ED Hub Two"))
        self.assertFails("out of date. Run: python3 scripts/check_tools.py --write")
        report, _ = self.run_check(write=True)
        self.assertEqual(report.errors, [])
        self.assertPasses()
        after = self.text("index.html")
        b0, _, a0 = self.block(before)
        b1, mid, a1 = self.block(after)
        self.assertEqual((b0, a0), (b1, a1))
        self.assertIn(">ED Hub Two</a>", mid)

    def test_13_crlf_kept(self):
        raw = (self.tmp / "index.html").read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
        (self.tmp / "index.html").write_bytes(raw)
        self.edit(lambda t: t.update(name="Renamed"))
        self.run_check(write=True)
        out = (self.tmp / "index.html").read_bytes()
        self.assertNotIn(b"\n", out.replace(b"\r\n", b""))
        self.assertIn(b">Renamed</a>", out)
        self.assertPasses()

    def test_13_no_write_when_another_rule_fails(self):
        before = self.text("index.html")
        self.edit(lambda t: t.update(name="Renamed", color="purple"))
        report, _ = self.run_check(write=True)
        self.assertTrue(report.errors)
        self.assertEqual(self.text("index.html"), before)

    def test_13_noscript_fails(self):
        html = self.text("index.html").replace("</main>", "<noscript><ul></ul></noscript>\n  </main>")
        self.write("index.html", html)
        self.assertFails("<noscript>")

    def test_13_markers_outside_tools(self):
        html = self.text("index.html")
        b, mid, a = self.block(html)
        html = b + a
        html = html.replace("<footer", mid + "\n    <footer", 1)
        self.write("index.html", html)
        self.assertFails('must be inside <div id="tools">')

    def test_13a_allow_stale(self):
        before = self.text("index.html")
        self.edit(lambda t: t.update(name="Renamed"))
        report, _ = self.run_check(allow_stale=True)
        self.assertEqual(report.errors, [])
        self.assertIn(check_tools.STALE_NOTICE, [m for _, m in report.notices])
        code, out = self.main_cli("--allow-stale-fallback", "--github")
        self.assertEqual(code, 0)
        self.assertIn("::notice file=index.html::" + check_tools.STALE_NOTICE, out)
        self.assertEqual(self.text("index.html"), before)
        # drift plus another problem still fails
        self.edit(lambda t: t.update(color="purple"))
        code, _ = self.main_cli("--allow-stale-fallback")
        self.assertEqual(code, 1)
        self.assertEqual(self.text("index.html"), before)

    def test_13b_node_check(self):
        if not shutil.which("node"):
            self.skipTest("node is not installed")
        app = self.text("app.js").splitlines()
        app.append("const broken = ;")
        self.write("app.js", "\n".join(app) + "\n")
        self.assertFails("app.js has a typing mistake", "(line %d)" % len(app))
        with mock.patch("check_tools.shutil.which", return_value=None):
            report, _ = self.run_check()
        self.assertEqual(report.errors, [])
        self.assertTrue(any("Skipped the app.js typing check" in m for _, m in report.notices))

    def test_14_escaping(self):
        def change(t):
            t["name"] = "A & B <x>"
            t["url"] = "https://example.org/?a=1&b=2"
        self.edit(change)
        self.run_check(write=True)
        html = self.text("index.html")
        self.assertIn('<a class="fallback" href="https://example.org/?a=1&amp;b=2">A &amp; B &lt;x&gt;</a>', html)
        self.assertPasses()

    def test_15_order(self):
        tools = self.tools()
        tools.insert(1, {"name": "Late", "group": "For patients and families", "description": "x",
                         "url": "https://example.org/late/", "icon": "icons/ed-hub.svg", "color": "gray",
                         "owner": "ED Administration"})
        self.save_tools(tools)
        items = [t for t, _ in check_tools.fallback_items(tools)]
        self.assertEqual(items, ["ED Hub", "Motion Voting", "Motion Voting: Settings", "Physician Hiring",
                                 "CPOE Order Review", "Late", "Patient Hub", "Patient Hub: Content editor",
                                 "Patient Hub: Map Studio", "Patient Hub: Editing guide",
                                 "Patient Hub: Visit statistics"])

    def test_16_readme_warns_only(self):
        self.write("README.md", self.text("README.md").replace("| Physician Hiring |", "| Hiring |"))
        report, _ = self.run_check()
        self.assertEqual(report.errors, [])
        self.assertTrue(any("Physician Hiring" in m and "README" in m for _, m in report.warnings))
        code, _ = self.main_cli()
        self.assertEqual(code, 0)

    def test_17_github_output(self):
        self.edit(lambda t: t.update(color="purple"))
        summary = self.tmp / "summary.md"
        code, out = self.main_cli("--github", env={"GITHUB_STEP_SUMMARY": str(summary)})
        self.assertEqual(code, 1)
        self.assertIn('::error file=tools.json::Tool 1 ("ED Hub"): "color" is "purple"', out)
        text = summary.read_text()
        self.assertIn('"color" is "purple"', text)
        self.assertIn("Fix tools.json and save again.", text)
        # and a clean run says so
        self.setUp()
        summary = self.tmp / "summary.md"
        code, out = self.main_cli("--github", env={"GITHUB_STEP_SUMMARY": str(summary)})
        self.assertEqual(code, 0)
        self.assertIn("All 5 tools look right.", summary.read_text())


class FakeAnswer:
    def __init__(self, status, headers=None):
        self.status = status
        self.headers = headers or {}


class FakeOpener:
    """Answers by URL from a dict of lists (one item per attempt, last one repeats)."""

    def __init__(self, plan, default=200):
        self.plan = plan
        self.default = default
        self.calls = []

    def __call__(self, req, timeout):
        url = req.full_url
        self.calls.append((req.get_method(), url, dict(req.header_items())))
        steps = self.plan.get(url)
        if not steps:
            return FakeAnswer(self.default, {"Access-Control-Allow-Origin": "*"})
        n = sum(1 for c in self.calls if c[1] == url) - 1
        step = steps[min(n, len(steps) - 1)]
        if isinstance(step, Exception):
            raise step
        if isinstance(step, int):
            return FakeAnswer(step, {"Access-Control-Allow-Origin": "*"})
        return step


class TestLive(Base):
    HUB = "https://mgh-ed-patient-hub.pages.dev"
    HIRING = "https://michaelgarronhospital-ed.github.io/mgh-ed-hiring/"
    CPOE = "https://mghcpoe.pythonanywhere.com"

    def live(self, plan):
        opener = FakeOpener(plan)
        sleeps = []
        report, _ = self.run_check(live=True, opener=opener, sleep=sleeps.append)
        return report, opener, sleeps

    def test_18_live(self):
        r, opener, _ = self.live({})
        self.assertEqual(r.errors, [])
        self.assertTrue(all(m == "HEAD" for m, _, _ in opener.calls))
        self.assertTrue(all(h.get("User-agent") == "MGH-ED-tools-check" for _, _, h in opener.calls))
        r, _, _ = self.live({self.CPOE: [401]})
        self.assertEqual(r.errors, [])
        r, _, _ = self.live({self.CPOE: [308]})
        self.assertEqual(r.errors, [])
        r, _, sleeps = self.live({self.CPOE: [404]})
        self.assertTrue(any("answered 404" in m for _, m in r.errors))
        self.assertEqual(sleeps, [5])
        # timeout, then success on retry
        r, _, sleeps = self.live({self.CPOE: [socket.timeout("timed out"), 200]})
        self.assertEqual(r.errors, [])
        self.assertEqual(sleeps, [5])
        r, _, _ = self.live({self.CPOE: [urllib.error.URLError("no route")]})
        self.assertTrue(any("did not answer" in m for _, m in r.errors))

    def test_18_live_check_rule(self):
        # check tool without ACAO fails
        r, opener, _ = self.live({self.HUB: [FakeAnswer(200, {})]})
        self.assertTrue(any("Turn off \"check\"" in m for _, m in r.errors))
        sent = [h for _, u, h in opener.calls if u == self.HUB and "Origin" in h]
        self.assertEqual(sent[0]["Origin"], "https://michaelgarronhospital-ed.github.io")
        # CORP same-site / same-origin fails with the message; cross-origin passes
        for corp in ("same-site", "same-origin"):
            r, _, _ = self.live({self.HUB: [FakeAnswer(200, {"Access-Control-Allow-Origin": "*",
                                                              "Cross-Origin-Resource-Policy": corp})]})
            self.assertTrue(any("Patient Hub now sends Cross-Origin-Resource-Policy: %s, which would make the page "
                                "wrongly say it is not loading. Turn off \"check\" for this tool." % corp in m
                                for _, m in r.errors), r.errors)
        r, _, _ = self.live({self.HUB: [FakeAnswer(200, {"Access-Control-Allow-Origin": "*",
                                                          "Cross-Origin-Resource-Policy": "cross-origin"})]})
        self.assertEqual(r.errors, [])
        # same-origin host needs no ACAO; a checked tool must answer exactly 200
        r, _, _ = self.live({self.HIRING: [FakeAnswer(200, {})]})
        self.assertEqual(r.errors, [])
        r, _, _ = self.live({self.HIRING: [401]})
        self.assertTrue(any("must answer 200" in m for _, m in r.errors))


class TestWorkflow(unittest.TestCase):
    def test_19_workflow(self):
        wf = (REPO / ".github" / "workflows" / "check.yml").read_text()
        self.assertRegex(wf, r"on:\n  push:\n    branches: \['\*\*'\]\n")
        code = "\n".join(ln.split("#", 1)[0] for ln in wf.splitlines())   # without comments
        self.assertNotRegex(code, r"(?m)^\s*schedule\s*:")
        self.assertNotRegex(code, r"(?m)^\s*tags(-ignore)?\s*:")
        self.assertIn("if: github.ref_name == env.SAVE_BRANCH", wf)
        expected = os.environ.get("EXPECTED_SAVE_BRANCH") or "main"
        m = re.search(r"^\s*SAVE_BRANCH:\s*(\S+)\s*$", wf, re.M)
        self.assertEqual(m.group(1), expected)
        self.assertIn("python3 scripts/check_tools.py --allow-stale-fallback --github", wf)
        self.assertNotIn("pull --rebase", wf)
        save = wf[wf.index("- name: Save the updated fallback list"):]
        fetch = save.index('git fetch --quiet origin "$GITHUB_REF_NAME"')
        reset = save.index("git reset --quiet --hard FETCH_HEAD")
        write = save.index("python3 scripts/check_tools.py --write")
        self.assertLess(fetch, reset)
        self.assertLess(reset, write)
        self.assertIn("for attempt in 1 2; do", save)
        self.assertEqual(save.count("git push"), 1)
        # every failure path ends in a warning and exit 0; no "exit 1" anywhere in the save step
        self.assertNotRegex(save, r"exit [1-9]")
        warnings = [ln.strip() for ln in save.splitlines() if "::warning::" in ln]
        self.assertGreaterEqual(len(warnings), 3)
        lines = [ln.strip() for ln in save.splitlines()]
        for i, ln in enumerate(lines):
            if ln.startswith('echo "::warning::') and "pages/builds" not in lines[i - 1]:
                self.assertTrue(lines[i + 1] in ("exit 0", "exit 0;"), (ln, lines[i + 1]))
        self.assertTrue(lines[-1] == "exit 0" or lines[-2] == "exit 0")


if __name__ == "__main__":
    unittest.main()
