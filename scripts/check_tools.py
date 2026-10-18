#!/usr/bin/env python3
"""Check the dashboard's tool list, and write the plain fallback list for you.

tools.json is the only file a person edits to add, rename, move or remove a tool.
This script checks it (and the icons, app.js, index.html and 404.html) and writes
the plain list of links inside index.html, between the "tools-fallback" markers.

    python3 scripts/check_tools.py           # check everything; exit 1 on any problem
    python3 scripts/check_tools.py --write   # check, then rewrite the fallback list if it is out of date
    python3 scripts/check_tools.py --live    # also ask each address if it answers (HEAD only; needs internet)
    python3 scripts/check_tools.py --github  # also print ::error / ::warning / ::notice lines and a step summary for GitHub
    python3 scripts/check_tools.py --allow-stale-fallback   # an out-of-date fallback list is a notice, not a failure

Standard library only; Python 3.9 or newer. Messages are plain sentences.
"""

import argparse
import datetime
import html
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DASHBOARD_HOST = "michaelgarronhospital-ed.github.io"
DASHBOARD_ORIGIN = "https://" + DASHBOARD_HOST
KNOWN_FIELDS = ["name", "group", "description", "url", "icon", "color", "owner", "repo",
                "related", "check", "notice", "notice_until"]
REQUIRED = [("name", 40), ("group", 40), ("description", 90), ("url", None), ("icon", None),
            ("color", None), ("owner", 60)]
SECRET_KEYS = {"password", "pass", "pwd", "token", "key", "code", "secret", "apikey"}
EM_DASH = "\u2014"
SUBJECT_PREFIX = "%5BED%20tools%5D"
START_MARK = "<!-- tools-fallback:start. Made from tools.json by scripts/check_tools.py. Do not edit by hand. -->"
END_MARK = "<!-- tools-fallback:end -->"
START_RE = re.compile(r"<!--\s*tools-fallback:start\b.*?-->", re.S)
END_RE = re.compile(r"<!--\s*tools-fallback:end\s*-->")
STALE_LOCAL = "The plain fallback list in index.html is out of date. Run: python3 scripts/check_tools.py --write"
STALE_NOTICE = "The plain fallback list will be updated automatically after this change is published."
USER_AGENT = "MGH-ED-tools-check"


class Report:
    def __init__(self):
        self.errors = []     # (file, message)
        self.warnings = []
        self.notices = []
        self.stale = False   # fallback list out of date (handled separately)

    def error(self, msg, file="tools.json"):
        self.errors.append((file, msg))

    def warn(self, msg, file="tools.json"):
        self.warnings.append((file, msg))

    def note(self, msg, file="tools.json"):
        self.notices.append((file, msg))


def label(i, tool):
    name = tool.get("name") if isinstance(tool, dict) else None
    if isinstance(name, str) and name.strip():
        return 'Tool %d ("%s")' % (i + 1, name.strip())
    return "Tool %d" % (i + 1)


def walk_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for v in value:
            for s in walk_strings(v):
                yield s
    elif isinstance(value, dict):
        for k, v in value.items():
            yield k
            for s in walk_strings(v):
                yield s


def read_js_list(app_js, const, report):
    """Read a one-line `const NAME = [...];` from app.js."""
    m = re.search(r"^const %s = (\[[^\n]*\]);" % const, app_js, re.M)
    if not m:
        report.error("app.js no longer has the one-line list const %s = [...]; this check needs it." % const, "app.js")
        return None
    try:
        values = json.loads(m.group(1))
    except ValueError:
        report.error("app.js: the line const %s = [...] could not be read. Keep it on one line, with double quotes." % const, "app.js")
        return None
    return [v for v in values if isinstance(v, str)]


def toronto_today(now=None):
    if now is None:
        now = datetime.datetime.now(datetime.timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=datetime.timezone.utc)
    try:
        from zoneinfo import ZoneInfo
        return now.astimezone(ZoneInfo("America/Toronto")).date()
    except Exception:  # zone data missing: fall back to this machine's local date
        return now.astimezone().date()


def check_url(where, url, report):
    if not isinstance(url, str) or not url.strip():
        report.error("%s: the link is empty." % where)
        return
    if re.search(r"\s", url):
        report.error('%s: the link "%s" has a space in it. Remove the space.' % (where, url))
        return
    if not url.startswith("https://"):
        report.error('%s: the link "%s" must start with https://' % (where, url))
        return
    try:
        parts = urllib.parse.urlsplit(url)
        host = parts.hostname or ""
    except ValueError:
        report.error('%s: the link "%s" is not a valid address.' % (where, url))
        return
    if "@" in parts.netloc:
        report.error('%s: the link "%s" has a name@ part before the address. Remove it.' % (where, url))
        return
    if host == "localhost" or host.endswith(".localhost") or "." not in host:
        report.error('%s: the link "%s" does not have a real web address after https://' % (where, url))
        return
    for key, _ in urllib.parse.parse_qsl(parts.query, keep_blank_values=True):
        if key.strip().lower() in SECRET_KEYS:
            report.error('%s: the link has "%s=" in it. Never put a password or code in a link. '
                         "This page and its repo are public." % (where, key))
            return


def check_icon(where, icon, root, report):
    if not re.fullmatch(r"icons/[A-Za-z0-9-]+\.svg", icon):
        report.error('%s: "icon" is "%s". It must look like icons/name-with-dashes.svg '
                     "(a file in the icons folder)." % (where, icon))
        return
    path = root / icon
    if not path.is_file():
        report.error("%s: the icon file %s does not exist. Upload it to the icons folder, "
                     "or use an existing icon." % (where, icon))
        return
    data = path.read_bytes()
    if len(data) >= 10 * 1024:
        report.error("%s: the icon file %s is too big (%d KB). Icons must be under 10 KB."
                     % (where, icon, len(data) // 1024))
        return
    text = data.decode("utf-8", "replace")
    body = re.sub(r"^﻿?\s*(<\?xml[^>]*\?>\s*)?", "", text)
    if not body.startswith("<svg"):
        report.error("%s: the icon file %s is not an SVG drawing (it must start with <svg)." % (where, icon))
        return
    if re.search(r"<script", text, re.I):
        report.error("%s: the icon file %s contains a script. Icons must be plain drawings." % (where, icon))
    if re.search(r"\son[a-z]+\s*=", text, re.I):
        report.error("%s: the icon file %s contains an on... event attribute. Icons must be plain drawings." % (where, icon))
    if re.search(r"""href\s*=\s*["']?\s*(https?:|//)""", text, re.I):
        report.error("%s: the icon file %s loads something from another site. Icons must not load anything." % (where, icon))
    if re.search(r"currentcolor", text, re.I):
        report.error('%s: the icon file %s uses currentColor. Inside the page it shows black; '
                     'use stroke="#fff" like the other icons.' % (where, icon))
    if 'viewBox="0 0 24 24"' not in text:
        report.warn('%s: the icon file %s does not have viewBox="0 0 24 24". It may look the wrong size.'
                    % (where, icon))


def check_tools(tools, root, colors, hosts, report, now=None):
    seen = {}
    for i, tool in enumerate(tools):
        where = label(i, tool)
        if not isinstance(tool, dict):
            report.error("%s is not a tool block. Each tool must be written as { ... }." % where)
            continue
        for key in tool:
            if key not in KNOWN_FIELDS:
                report.error('%s: "%s" is not a known field. Check the spelling. Known fields: %s.'
                             % (where, key, ", ".join(KNOWN_FIELDS)))
        for key, limit in REQUIRED:
            value = tool.get(key)
            if not isinstance(value, str) or not value.strip():
                report.error('%s: "%s" is missing or empty. Every tool needs it.' % (where, key))
            elif limit and len(value.strip()) > limit:
                report.error('%s: "%s" is %d characters long. Keep it to %d or fewer.'
                             % (where, key, len(value.strip()), limit))
        name = tool.get("name")
        if isinstance(name, str) and name.strip():
            k = name.strip().lower()
            if k in seen:
                report.error('%s has the same name as tool %d. Each tool needs its own name.' % (where, seen[k] + 1))
            else:
                seen[k] = i

        if isinstance(tool.get("url"), str) and tool["url"].strip():
            check_url(where, tool["url"], report)
        if isinstance(tool.get("icon"), str) and tool["icon"].strip():
            check_icon(where, tool["icon"].strip(), root, report)
        color = tool.get("color")
        if colors is not None and isinstance(color, str) and color.strip() and color not in colors:
            report.error('%s: "color" is "%s". Use one of: %s.' % (where, color, ", ".join(colors)))

        if "repo" in tool:
            repo = tool["repo"]
            if not (repo in ("", "private") or (isinstance(repo, str) and repo.startswith("https://github.com/"))):
                report.error('%s: "repo" must be "", "private", or an address starting with https://github.com/' % where)

        if "related" in tool:
            check_related(where, tool["related"], report)

        if "check" in tool:
            chk = tool["check"]
            if chk is not True and chk is not False:
                report.error('%s: "check" must be true (or left out). Write it without quotes: "check": true' % where)
            elif chk is True and hosts is not None and isinstance(tool.get("url"), str):
                try:
                    host = urllib.parse.urlsplit(tool["url"]).hostname or ""
                except ValueError:
                    host = ""
                if host not in hosts:
                    report.error('%s: "check" only works for addresses on %s. Remove the line "check": true for this tool.'
                                 % (where, " or ".join(hosts)))

        if "notice" in tool:
            notice = tool["notice"]
            if not isinstance(notice, str) or not notice.strip():
                report.error('%s: "notice" must be a short sentence in quotes (or delete the line).' % where)
            else:
                if len(notice.strip()) > 140:
                    report.error('%s: "notice" is %d characters long. Keep it to 140 or fewer.' % (where, len(notice.strip())))
                if "<" in notice or ">" in notice:
                    report.error('%s: "notice" cannot contain < or >.' % where)
        if "notice_until" in tool:
            until = tool["notice_until"]
            if "notice" not in tool:
                report.error('%s: "notice_until" only works together with "notice". Delete it or add a notice.' % where)
            elif not isinstance(until, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", until):
                report.error('%s: "notice_until" must be a date written year-month-day, like "2026-10-23".' % where)
            else:
                try:
                    day = datetime.date.fromisoformat(until)
                except ValueError:
                    report.error('%s: "notice_until" is "%s", which is not a real date.' % (where, until))
                else:
                    if day < toronto_today(now):
                        report.warn('%s: the notice ended on %s and is no longer shown. '
                                    'Delete the "notice" and "notice_until" lines.' % (where, until))


def check_related(where, related, report):
    if not isinstance(related, dict):
        report.error('%s: "related" must be a block with "links" (and an optional "label").' % where)
        return
    for key in related:
        if key not in ("label", "links"):
            report.error('%s: "related" has an unknown field "%s". It only takes "label" and "links".' % (where, key))
    lab = related.get("label")
    if lab is None:
        pass                                  # optional: no label, the links show on their own
    elif not isinstance(lab, str) or not lab.strip():
        report.error('%s: the "related" label is empty. Delete the "label" line or write one.' % where)
    elif len(lab.strip()) > 30:
        report.error('%s: the "related" label is %d characters long. Keep it to 30 or fewer.' % (where, len(lab.strip())))
    links = related.get("links")
    if not isinstance(links, list) or not links:
        report.error('%s: "related" needs "links": a list with at least one link.' % where)
        return
    for j, link in enumerate(links):
        lw = "%s, related link %d" % (where, j + 1)
        if not isinstance(link, dict):
            report.error('%s must be a block with "name" and "url".' % lw)
            continue
        for key in link:
            if key not in ("name", "url"):
                report.error('%s has an unknown field "%s". A related link only takes "name" and "url".' % (lw, key))
        nm = link.get("name")
        if not isinstance(nm, str) or not nm.strip():
            report.error('%s: "name" is missing or empty.' % lw)
        elif len(nm.strip()) > 30:
            report.error('%s: "name" is %d characters long. Keep it to 30 or fewer.' % (lw, len(nm.strip())))
        else:
            lw = '%s ("%s")' % (lw, nm.strip())
        if not isinstance(link.get("url"), str) or not link.get("url").strip():
            report.error('%s: "url" is missing or empty.' % lw)
        else:
            check_url(lw, link["url"], report)


def mailto_parts(href):
    """(address, {param: raw value}) from a mailto: href as written in HTML."""
    raw = html.unescape(href)
    if not raw.lower().startswith("mailto:"):
        return None, {}
    addr, _, query = raw[len("mailto:"):].partition("?")
    params = {}
    for piece in query.split("&"):
        if "=" in piece:
            k, v = piece.split("=", 1)
            params[k.lower()] = v
    return urllib.parse.unquote(addr), params


def check_contact(index_html, page_404, report):
    tags = re.findall(r"<a\b[^>]*\bid=\"report-link\"[^>]*>", index_html)
    if len(tags) != 1:
        report.error('index.html must have exactly one "Report a problem" link (<a id="report-link" ...>); it has %d.'
                     % len(tags), "index.html")
        return
    m = re.search(r'\bhref="([^"]*)"', tags[0])
    addr, params = mailto_parts(m.group(1) if m else "")
    if not addr:
        report.error('index.html: the "Report a problem" link must be an email link (href="mailto:...").', "index.html")
        return
    if not params.get("subject", "").startswith(SUBJECT_PREFIX):
        report.error('index.html: the "Report a problem" email subject must start with [ED tools].', "index.html")
    found = False
    for href in re.findall(r'<a\b[^>]*\bhref="(mailto:[^"]*)"', page_404):
        a404, p404 = mailto_parts(href)
        if a404 and a404.lower() == addr.lower():
            found = True
            if not p404.get("subject", "").startswith(SUBJECT_PREFIX):
                report.error("404.html: the report email subject must start with [ED tools].", "404.html")
    if not found:
        report.error("404.html must have an email link to the same address as index.html (%s)." % addr, "404.html")


def fallback_items(tools):
    """(text, url) pairs in page order: groups in first-use order, related links after their tool."""
    groups = []
    by_group = {}
    for t in tools:
        g = t.get("group") or "Tools"
        if g not in by_group:
            by_group[g] = []
            groups.append(g)
        by_group[g].append(t)
    items = []
    for g in groups:
        for t in by_group[g]:
            items.append((t["name"], t["url"]))
            rel = t.get("related")
            if isinstance(rel, dict):
                for link in rel.get("links") or []:
                    items.append(("%s: %s" % (t["name"], link["name"]), link["url"]))
    return items


def fallback_block(tools, indent, eol):
    lines = [START_MARK, '<ul class="cards plain" aria-label="ED tools">']
    for text, url in fallback_items(tools):
        lines.append('  <li><a class="fallback" href="%s">%s</a></li>'
                     % (html.escape(url, quote=True), html.escape(text, quote=True)))
    lines += ["</ul>", END_MARK]
    return lines[0] + "".join(eol + indent + ln for ln in lines[1:])


def locate_fallback(index_html, report):
    """Return (start, end, indent) of the marker block, or None after reporting why."""
    if re.search(r"<noscript", index_html, re.I):
        report.error("index.html still has a <noscript> list. Delete it: the plain list between the "
                     "tools-fallback markers replaces it.", "index.html")
    starts = list(START_RE.finditer(index_html))
    ends = list(END_RE.finditer(index_html))
    if len(starts) != 1 or len(ends) != 1:
        report.error("index.html must have exactly one tools-fallback:start and one tools-fallback:end marker "
                     "(found %d and %d)." % (len(starts), len(ends)), "index.html")
        return None
    s, e = starts[0], ends[0]
    if e.start() < s.end():
        report.error("index.html: the tools-fallback:end marker comes before the start marker.", "index.html")
        return None
    div = re.search(r'<div\s+id="tools"\s*>', index_html)
    close = index_html.find("</div>", div.end()) if div else -1
    if not div or close < 0 or not (div.end() <= s.start() and e.end() <= close):
        report.error('index.html: the tools-fallback markers must be inside <div id="tools">.', "index.html")
        return None
    line_start = index_html.rfind("\n", 0, s.start()) + 1
    indent = index_html[line_start:s.start()]
    if indent.strip():
        indent = ""
    return s.start(), e.end(), indent


def check_node(root, report):
    node = shutil.which("node")
    if not node:
        report.note("Skipped the app.js typing check: node is not installed on this computer.", "app.js")
        return
    try:
        res = subprocess.run([node, "--check", str(root / "app.js")], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as err:
        report.note("Skipped the app.js typing check: node could not run (%s)." % err, "app.js")
        return
    if res.returncode != 0:
        m = re.search(r"app\.js:(\d+)", res.stderr or "")
        line = m.group(1) if m else "unknown"
        report.error("app.js has a typing mistake that stops the page from building its tiles (line %s). "
                     "The plain list still shows, but fix app.js." % line, "app.js")


def check_readme(tools, readme, report):
    m = re.search(r"^## The tools\s*$(.*?)(?=^## |\Z)", readme, re.M | re.S)
    section = m.group(1) if m else ""
    for i, t in enumerate(tools):
        name = t.get("name")
        if isinstance(name, str) and name.strip() and name.strip() not in section:
            report.warn('%s is not in the README "The tools" table. Add a row so the next person knows '
                        "who uses it and how they sign in." % label(i, t), "README.md")


# ---- --live ------------------------------------------------------------------

class _Answer:
    def __init__(self, status, headers):
        self.status = status
        self.headers = headers


def default_opener(req, timeout):
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return _Answer(res.status, res.headers)
    except urllib.error.HTTPError as err:
        return _Answer(err.code, err.headers)


def head_once(url, opener, origin=False):
    headers = {"User-Agent": USER_AGENT}
    if origin:
        headers["Origin"] = DASHBOARD_ORIGIN
    req = urllib.request.Request(url, method="HEAD", headers=headers)
    return opener(req, 15)


def head_with_retry(url, opener, sleep, origin=False):
    """One HEAD, and one retry after 5 s if it failed or answered 400 or more."""
    last_err = None
    for attempt in (1, 2):
        try:
            ans = head_once(url, opener, origin)
            if ans.status < 400 or ans.status in (401, 403) or attempt == 2:
                return ans, None
        except (urllib.error.URLError, socket.timeout, TimeoutError, OSError, ValueError) as err:
            last_err = err
        if attempt == 1:
            sleep(5)
    return None, last_err


def live_checks(tools, report, opener=None, sleep=time.sleep):
    opener = opener or default_opener
    for i, t in enumerate(tools):
        if not isinstance(t, dict) or not isinstance(t.get("url"), str):
            continue
        where = label(i, t)
        links = [(where, t["url"])]
        rel = t.get("related")
        if isinstance(rel, dict):
            for link in rel.get("links") or []:
                if isinstance(link, dict) and isinstance(link.get("url"), str):
                    links.append(('%s, related link "%s"' % (where, link.get("name")), link["url"]))
        for lw, url in links:
            ans, err = head_with_retry(url, opener, sleep)
            if ans is None:
                report.error("%s: %s did not answer (%s)." % (lw, url, err))
            elif not (ans.status < 400 or ans.status in (401, 403)):
                report.error("%s: %s answered %d. Check that the address is right." % (lw, url, ans.status))
        if t.get("check") is True:
            live_check_rule(where, t, report, opener, sleep)


def live_check_rule(where, t, report, opener, sleep):
    url = t["url"]
    host = urllib.parse.urlsplit(url).hostname or ""
    ans, err = head_with_retry(url, opener, sleep, origin=True)
    if ans is None:
        report.error("%s: the status check could not reach %s (%s)." % (where, url, err))
        return
    if ans.status != 200:
        report.error('%s: for "check" the address must answer 200, but it answered %d.' % (where, ans.status))
        return
    if host == DASHBOARD_HOST:
        return
    get = ans.headers.get if ans.headers is not None else (lambda k, d=None: d)
    name = t.get("name", where)
    acao_ok = (get("Access-Control-Allow-Origin") or "").strip() in ("*", DASHBOARD_ORIGIN)
    if not acao_ok:
        report.error('%s no longer allows the page to read its status (no Access-Control-Allow-Origin). '
                     'Turn off "check" for this tool.' % name)
    # Cross-Origin-Resource-Policy only blocks the page's second, no-cors try. While the
    # host still allows the first try (Access-Control-Allow-Origin above), the check works,
    # so it is a warning; without that header it means wrong "not loading" warnings.
    corp = (get("Cross-Origin-Resource-Policy") or "").strip()
    if corp and corp.lower() != "cross-origin":
        if acao_ok:
            report.warn('%s now sends Cross-Origin-Resource-Policy: %s. The check still works because it also '
                        'sends Access-Control-Allow-Origin, but if that header goes, the page would wrongly say '
                        'it is not loading. Then turn off "check" for this tool.' % (name, corp))
        else:
            report.error('%s now sends Cross-Origin-Resource-Policy: %s, which would make the page wrongly say it '
                         'is not loading. Turn off "check" for this tool.' % (name, corp))


# ---- main ----------------------------------------------------------------------

def run(root=ROOT, write=False, live=False, allow_stale=False, now=None, opener=None, sleep=time.sleep):
    """Run every check. Returns (report, tool count). Writes index.html only when asked and safe."""
    report = Report()
    tools_path = root / "tools.json"
    try:
        text = tools_path.read_text(encoding="utf-8")
    except OSError:
        report.error("tools.json is missing.")
        return report, 0
    try:
        tools = json.loads(text)
    except ValueError as err:
        line = getattr(err, "lineno", "?")
        col = getattr(err, "colno", "?")
        report.error("tools.json is not valid JSON at line %s, column %s. This is usually a missing or extra "
                     "comma just before that spot." % (line, col))
        return report, 0
    if not isinstance(tools, list) or not tools:
        report.error("tools.json must be a list of tools: it starts with [ and ends with ], with at least one "
                     "tool inside. (The page needs a list.)")
        return report, 0
    if any(EM_DASH in s for s in walk_strings(tools)):
        report.error("tools.json contains an em dash. Use a plain dash, comma or colon instead.")

    def read(name):
        try:
            return (root / name).read_text(encoding="utf-8")
        except OSError:
            report.error("%s is missing." % name, name)
            return ""

    app_js = read("app.js")
    colors = read_js_list(app_js, "COLORS", report) if app_js else None
    hosts = read_js_list(app_js, "CHECKABLE_HOSTS", report) if app_js else None
    check_tools(tools, root, colors, hosts, report, now)

    index_raw = (root / "index.html").read_bytes() if (root / "index.html").is_file() else b""
    index_html = index_raw.decode("utf-8") if index_raw else read("index.html")
    page_404 = read("404.html")
    if index_html and page_404:
        check_contact(index_html, page_404, report)

    spot = locate_fallback(index_html, report) if index_html else None
    new_html = None
    if spot and not report.errors:
        s, e, indent = spot
        eol = "\r\n" if "\r\n" in index_html else "\n"
        block = fallback_block(tools, indent, eol)
        if index_html[s:e] != block:
            report.stale = True
            new_html = index_html[:s] + block + index_html[e:]

    if app_js:
        check_node(root, report)
    readme = (root / "README.md").read_text(encoding="utf-8") if (root / "README.md").is_file() else ""
    check_readme([t for t in tools if isinstance(t, dict)], readme, report)
    if live and not report.errors:
        live_checks(tools, report, opener=opener, sleep=sleep)

    if report.stale:
        if write and not report.errors:
            with open(root / "index.html", "w", encoding="utf-8", newline="") as f:
                f.write(new_html)
            report.note("Updated the plain fallback list in index.html from tools.json.", "index.html")
            report.stale = False
        elif allow_stale:
            report.note(STALE_NOTICE, "index.html")
            report.stale = False
        else:
            report.error(STALE_LOCAL, "index.html")
    return report, len(tools)


def gh_escape(msg):
    return msg.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Check tools.json and write the plain fallback list.")
    ap.add_argument("--write", action="store_true", help="rewrite the fallback list in index.html if out of date")
    ap.add_argument("--live", action="store_true", help="also ask each address if it answers (HEAD only)")
    ap.add_argument("--github", action="store_true", help="print GitHub annotations and a step summary")
    ap.add_argument("--allow-stale-fallback", action="store_true", help="an out-of-date list is a notice only")
    args = ap.parse_args(argv)

    report, count = run(ROOT, write=args.write, live=args.live, allow_stale=args.allow_stale_fallback)

    for file, msg in report.errors:
        print("PROBLEM: " + msg)
    for file, msg in report.warnings:
        print("Warning: " + msg)
    for file, msg in report.notices:
        print("Note: " + msg)
    ok = not report.errors
    if ok:
        print("All %d tools look right." % count)
    else:
        print("Fix tools.json and save again." if any(f == "tools.json" for f, _ in report.errors)
              else "Fix the problems above and save again.")

    if args.github:
        for kind, items in (("error", report.errors), ("warning", report.warnings), ("notice", report.notices)):
            for file, msg in items:
                print("::%s file=%s::%s" % (kind, file, gh_escape(msg)))
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            lines = ["## Check the tool list", ""]
            if ok:
                lines.append("All %d tools look right." % count)
            else:
                lines += ["- " + msg for _, msg in report.errors]
                lines += ["", "Fix tools.json and save again."]
            if report.warnings:
                lines += ["", "Warnings:"] + ["- " + msg for _, msg in report.warnings]
            if report.notices:
                lines += ["", "Notes:"] + ["- " + msg for _, msg in report.notices]
            with open(summary, "a", encoding="utf-8") as f:
                f.write("\n".join(lines) + "\n")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
