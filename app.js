document.getElementById("tools")?.classList.add("app-running"); // first: pauses the 4 s CSS reveal of the plain list (styles.css)

// Builds the page from tools.json. All tool details live in that file; nothing
// here needs to change when a tool is added, renamed, regrouped or moved.
//
// Tools are shown in groups (tools.json "group"; groups appear in the order they
// are first used); each group is one grouped list and each tool is one row in it.
// The tool's name is the main link, stretched over the whole row (CSS ::after), so
// a click anywhere opens the tool. An optional `related` block adds a few staff
// links on a quiet line under the row's text; they sit above the stretched link,
// because links cannot nest.
//
// index.html already holds a plain list of every link, made from tools.json by
// scripts/check_tools.py. The tiles replace it. If tools.json cannot be loaded,
// the plain list stays and shows at once, with an error line above it.
//
// Status (README "Status on tiles"): a tool with "check": true is asked, with one
// tiny HEAD request, whether it answers. Only a real problem shows anything ("Not
// loading right now"), and only after a retry, after confirming this device is
// online, and never from a check that ran while the page was hidden. A typed
// "notice" (optional "notice_until" end date) shows a short note on the tile.
//
// Keep COLORS and CHECKABLE_HOSTS each on one line: scripts/check_tools.py reads them.

const COLORS = ["blue", "indigo", "teal", "green", "orange", "pink", "red", "gray"];

// Hosts whose answers the browser can read: our own GitHub Pages address (same origin)
// and Cloudflare Pages, which sends "access-control-allow-origin: *". scripts/check_tools.py
// reads this line; keep it on one line. A tool elsewhere cannot use "check".
const CHECKABLE_HOSTS = ["michaelgarronhospital-ed.github.io", "mgh-ed-patient-hub.pages.dev"];
const CHECK_START_MS = 1000;
const CHECK_TIMEOUT_MS = 8000;
const CHECK_RETRY_MS = 5000;
const RECHECK_AFTER_MS = 5 * 60 * 1000;
const LOAD_TIMEOUT_MS = 10000;
const SCOPE_LINE = "For tool problems only. Not for medical questions. Please do not write names, health card numbers or health details.";
const SVG_NS = "http://www.w3.org/2000/svg";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// A small line icon drawn with currentColor. paths: list of "d" strings.
function icon(paths, circle) {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({ "aria-hidden": "true", viewBox: "0 0 16 16", width: "12", height: "12",
    fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round" })) {
    svg.setAttribute(k, v);
  }
  if (circle) {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", "8"); c.setAttribute("cy", "8"); c.setAttribute("r", "6.5");
    svg.append(c);
  }
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}

function addDescribedBy(node, id) {
  const ids = (node.getAttribute("aria-describedby") || "").split(" ").filter(Boolean);
  if (!ids.includes(id)) ids.push(id);
  node.setAttribute("aria-describedby", ids.join(" "));
}

function removeDescribedBy(node, id) {
  const ids = (node.getAttribute("aria-describedby") || "").split(" ").filter((x) => x && x !== id);
  if (ids.length) node.setAttribute("aria-describedby", ids.join(" "));
  else node.removeAttribute("aria-describedby");
}

// Today's date on this device, YYYY-MM-DD from local parts (not UTC).
function localToday() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Today's date in Toronto, YYYY-MM-DD, whatever time zone this device is set to.
// The checker (scripts/check_tools.py) uses the same date for "the notice ended".
function torontoToday() {
  try {
    const parts = {};
    for (const p of new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric",
      month: "2-digit", day: "2-digit" }).formatToParts(new Date())) parts[p.type] = p.value;
    if (parts.year && parts.month && parts.day) return parts.year + "-" + parts.month + "-" + parts.day;
  } catch { /* no time zone data: use this device's date */ }
  return localToday();
}

// A notice shows unless notice_until is a readable date that has passed in Toronto
// (it shows to the end of that day). An unreadable date shows the notice: the person
// meant it to show.
function noticeShows(tool) {
  if (typeof tool.notice !== "string" || !tool.notice.trim()) return false;
  const until = tool.notice_until;
  if (typeof until !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(until)) return true;
  return torontoToday() <= until;
}

// Related links the page can show: a name and an https:// address (same rule as usable()).
function usableLinks(related) {
  if (!related || typeof related !== "object" || !Array.isArray(related.links)) return [];
  return related.links.filter((link) => {
    const ok = link && typeof link.name === "string" && link.name.trim() &&
      typeof link.url === "string" && link.url.startsWith("https://");
    if (!ok) console.warn("tools.json: a related link without a name or an https:// url was skipped.");
    return ok;
  });
}

// The label is optional: without one the links show on their own line, and the list is
// named after the tool for screen readers.
function relatedBlock(related, links, toolName) {
  const box = el("div", "related");
  const label = typeof related.label === "string" ? related.label.trim() : "";
  const list = el("ul", "related-links");
  list.setAttribute("aria-label", label || toolName + " links");
  if (label) box.append(el("p", "related-head", label));
  for (const link of links) {
    const li = el("li");
    const a = el("a", null, link.name);
    a.href = link.url;
    li.append(a);
    list.append(li);
  }
  box.append(list);
  return box;
}

function card(tool) {
  const li = el("li");
  const card = el("article", "card");
  card.dataset.tool = String(tool._i);

  const row = el("div", "card-row");
  const icn = el("span", "icon " + (COLORS.includes(tool.color) ? tool.color : "gray"));
  const img = document.createElement("img");
  img.src = tool.icon;
  img.alt = "";
  icn.append(img);

  const text = el("div", "card-text");
  const name = el("h3", "name");
  const main = el("a", "main", tool.name);
  main.href = tool.url;
  name.append(main);
  text.append(name, el("p", "desc", tool.description));

  if (noticeShows(tool)) {
    const note = el("p", "note");
    note.id = "note-" + tool._i;
    note.append(icon(["M8 7.2v4", "M8 4.8v.1"], true), el("span", "sr-only", "Note: "), document.createTextNode(tool.notice.trim()));
    text.append(note);
    addDescribedBy(main, note.id);
  }

  const chev = el("span", "chev");
  chev.setAttribute("aria-hidden", "true");

  row.append(icn, text, chev);
  card.append(row);
  const links = usableLinks(tool.related);
  if (links.length) card.append(relatedBlock(tool.related, links, tool.name));
  li.append(card);
  return li;
}

// Keep only entries the page can show; a bad entry never hides the others.
function usable(tools) {
  if (!Array.isArray(tools)) throw new Error("tools.json is not a list");
  const out = [];
  tools.forEach((t, i) => {
    if (!t || typeof t !== "object" || Array.isArray(t)) { console.warn("tools.json entry " + (i + 1) + " is not a tool block; skipped."); return; }
    if (typeof t.name !== "string" || !t.name.trim()) { console.warn("tools.json entry " + (i + 1) + " has no name; skipped."); return; }
    if (typeof t.url !== "string" || !t.url.startsWith("https://")) { console.warn('tools.json "' + t.name + '" has no https:// url; skipped.'); return; }
    out.push(Object.assign({}, t, { _i: out.length }));
  });
  if (!out.length) throw new Error("tools.json has no usable tools");
  return out;
}

function render(tools) {
  const root = document.getElementById("tools");
  const groups = [];
  for (const t of tools) {
    const g = t.group || "Tools";
    let entry = groups.find((x) => x.name === g);
    if (!entry) { entry = { name: g, tools: [] }; groups.push(entry); }
    entry.tools.push(t);
  }
  // Build everything first, then swap in one step, so an error never leaves half a page.
  const sections = groups.map((g, i) => {
    const section = el("section", "group");
    const id = "group-" + i;
    const h = el("h2", "group-title", g.name);
    h.id = id;
    const list = el("ul", "cards");
    list.setAttribute("aria-labelledby", id);
    list.append(...g.tools.map(card));
    section.append(h, list);
    return section;
  });
  root.replaceChildren(...sections);
}

function showLoadError() {
  const root = document.getElementById("tools");
  if (!root) return;
  const plain = root.querySelector(":scope > .plain");
  root.querySelector(":scope > .error")?.remove();
  if (plain) {
    root.classList.add("show-fallback");
    root.insertBefore(el("p", "error", "The tool list could not be loaded. Here are the main links. Please refresh the page later."), plain);
  } else {
    root.replaceChildren(el("p", "error", "The tool list could not be loaded. Please refresh the page."));
  }
}

// ---- status checks ------------------------------------------------------------

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function head(url, mode) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
  try {
    return await fetch(url, { method: "HEAD", mode, cache: "no-store", credentials: "omit",
                              redirect: "follow", signal: ctrl.signal });
  } finally { clearTimeout(timer); }
}

// "ok", "problem" or "unknown". Only "problem" ever shows anything.
async function checkOnce(url) {
  try {
    const res = await head(url, "cors");
    if (res.ok || res.status === 401 || res.status === 403) return "ok";
    if (res.status === 404 || res.status === 410 || res.status >= 500) return "problem";
    return "unknown";                       // 405 (HEAD refused), 429, anything odd: say nothing
  } catch (err) {
    if (err && err.name === "AbortError") return "problem";   // no answer in 8 seconds
    // Network failure, or the host stopped allowing CORS. A no-cors request tells them
    // apart: if it gets any answer at all, the site is up and we just cannot read it.
    try { await head(url, "no-cors"); return "unknown"; } catch { return "problem"; }
  }
}

async function check(url) {
  const first = await checkOnce(url);
  if (first !== "problem") return first;
  await wait(CHECK_RETRY_MS);               // one blip never shows a warning
  return checkOnce(url);
}

// Is it the tool, or this device? Ask our own server for tools.json. Any answer at
// all, even an error page, proves this device is online (a GitHub Pages outage must
// still show the GitHub tools as not loading); only a failed request means offline.
async function deviceOnline() {
  if (navigator.onLine === false) return false;
  try { await head(new URL("tools.json", location.href).href, "same-origin"); return true; }
  catch { return false; }
}

function checkable(tool) {
  if (tool.check !== true) return false;
  try { return CHECKABLE_HOSTS.includes(new URL(tool.url).hostname); } catch { return false; }
}

function reportHref(tool) {
  const link = document.getElementById("report-link");
  if (!link) return null;
  let address;
  try { address = new URL(link.href).pathname; } catch { return null; }
  if (!address || !address.includes("@")) return null;
  const now = new Date();
  const when = localToday() + " " + String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
  const body = [
    "Tool: " + tool.name + " (" + tool.url + ")",
    "The ED tools page said it was not loading at " + when + ".",
    "What happened when you tried it:",
    "",
    SCOPE_LINE,
  ].map(encodeURIComponent).join("%0D%0A");
  return "mailto:" + address + "?subject=" + encodeURIComponent("[ED tools] " + tool.name + " is not loading") + "&body=" + body;
}

function markProblem(tool) {
  const card = document.querySelector('.card[data-tool="' + tool._i + '"]');
  if (!card || card.querySelector(".status")) return;
  const line = el("p", "status");
  const pill = el("span", "ed-pill ed-pill-warn");
  pill.id = "status-" + tool._i;
  pill.append(icon(["M8 2 1.5 13.5h13Z", "M8 6.5v3", "M8 11.6v.1"]), document.createTextNode("Not loading right now"));
  line.append(pill);
  const href = reportHref(tool);
  if (href) {
    const a = el("a", "status-report", "Report it");
    a.href = href;
    a.append(el("span", "sr-only", ": " + tool.name + " is not loading"));
    line.append(a);
  }
  card.querySelector(".desc").after(line);
  const main = card.querySelector(".main");
  // The status reads first, then the note: "status-N note-N".
  const ids = (main.getAttribute("aria-describedby") || "").split(" ").filter(Boolean);
  main.setAttribute("aria-describedby", [pill.id, ...ids.filter((x) => x !== pill.id)].join(" "));
}

function unmark(line) {
  const pill = line.querySelector(".ed-pill");
  const main = line.closest(".card")?.querySelector(".main");
  if (pill && main) removeDescribedBy(main, pill.id);
  line.remove();
}

// Show the result of a finished round: marks stay on tools that are still not
// loading (the same element, so nothing flickers), go from tools that recovered,
// and appear on new ones. The live region speaks only when the list changed.
function showProblems(problems) {
  const keep = new Set(problems.map((t) => String(t._i)));
  const before = [];
  let had = 0;
  document.querySelectorAll("#tools .status").forEach((line) => {
    had++;
    const i = line.closest(".card")?.dataset.tool;
    if (keep.has(i)) before.push(i);
    else unmark(line);
  });
  problems.forEach(markProblem);
  const live = document.getElementById("status-announce");
  if (!live) return;
  if (!problems.length) { live.textContent = ""; return; }
  const noneNew = before.length === problems.length;
  if (noneNew && had > problems.length) { live.textContent = ""; return; }   // fewer than before: drop the old sentence, say nothing
  if (noneNew && live.textContent) return;   // same tools as before: say nothing new
  const names = problems.map((t) => t.name);
  live.textContent = names.length === 1
    ? names[0] + " is not loading right now."
    : names.length + " tools are not loading right now: " + names.join(", ") + ".";
}

// Offline: run again once the device says it is back online (one listener at a time).
function runWhenOnline() {
  if (status.waitingForOnline) return;
  status.waitingForOnline = true;
  window.addEventListener("online", () => { status.waitingForOnline = false; scheduleRun(CHECK_START_MS); }, { once: true });
}

const status = {
  tools: [],
  runId: 0,
  hiddenDuringRun: false,
  waitingForVisible: false,
  timer: null,
  lastRunAt: 0,
  waitingForOnline: false,
};

// Older than five minutes: ask again (back button, or the page brought back to the
// front). What is shown stays until the new round's answer replaces it. No polling.
function recheckIfStale() {
  if (!status.lastRunAt || Date.now() - status.lastRunAt <= RECHECK_AFTER_MS) return false;
  status.runId++;                           // ignore any run still in flight
  scheduleRun(CHECK_START_MS);
  return true;
}

function scheduleRun(delay) {
  clearTimeout(status.timer);
  status.waitingForVisible = false;
  if (document.visibilityState !== "visible") { status.waitingForVisible = true; return; }
  status.timer = setTimeout(runChecks, delay);
}

async function runChecks() {
  if (document.visibilityState !== "visible") { status.waitingForVisible = true; return; }
  if (navigator.onLine === false) { runWhenOnline(); return; }   // check once back online
  const id = ++status.runId;
  status.hiddenDuringRun = false;
  status.lastRunAt = Date.now();
  const results = await Promise.all(status.tools.map((t) => check(t.url)));
  if (id !== status.runId) return;          // a newer run took over
  const problems = status.tools.filter((t, i) => results[i] === "problem");
  if (!problems.length) { showProblems([]); return; }   // healthy shows nothing
  if (!(await deviceOnline())) {            // it is this device, not the tools: keep what is shown
    if (id === status.runId && navigator.onLine === false) runWhenOnline();
    return;
  }
  if (id !== status.runId) return;
  if (status.hiddenDuringRun) {             // iPhone paused the page: results are not trustworthy
    scheduleRun(CHECK_START_MS);
    return;
  }
  showProblems(problems);
}

function startChecks(tools) {
  status.tools = tools.filter(checkable);
  if (!status.tools.length) return;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") { status.hiddenDuringRun = true; return; }
    if (recheckIfStale()) return;
    if (status.waitingForVisible) scheduleRun(CHECK_START_MS);
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) recheckIfStale();
  });
  scheduleRun(CHECK_START_MS);
}

async function main() {
  let tools;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LOAD_TIMEOUT_MS);
    try {
      const res = await fetch("tools.json", { cache: "no-cache", signal: ctrl.signal });
      if (!res.ok) throw new Error("tools.json returned " + res.status);
      tools = usable(await res.json());
    } finally { clearTimeout(timer); }
    render(tools);
  } catch (err) {
    console.warn("The tool list could not be loaded:", err);
    showLoadError();
    return;
  }
  startChecks(tools);
}

main();
