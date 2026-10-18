// ============================================================================
//  The page flows' harness (design B.8.3): a static server for the test site,
//  the local emulators over REST, and browsers driven by playwright-core.
//  Only ever 127.0.0.1 and the demo project: nothing here can reach a real
//  Firebase project. The Firebase SDK files are fetched from gstatic once and
//  kept in passwords/tests/site-cache/ (git-ignored), so a run is quick and the
//  page still loads them from their real address.
// ============================================================================
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit, devices } from "playwright-core";
import { makeLock, seal, openVault } from "../../vault.js";
import { ACCOUNTS } from "../../config.js";
import { makeSite, PROJECT, TEST_UID } from "../make-site.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TESTS = path.resolve(HERE, "..");
const CACHE = path.join(TESTS, "site-cache");
export const PORT = Number(process.env.PASSWORDS_TEST_PORT || 8097);
export const BASE = `http://127.0.0.1:${PORT}`;
export const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9096"}`;
export const FS = `http://${process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8086"}`;
const OWNER = { authorization: "Bearer owner", "content-type": "application/json" };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- invented values, never real ----------------------------------------------
export const V = {
  lead: "lantern harbour test 1", ed: "river stone test 22", guest: "maple window test 3",
  lead2: "violet orchard test 4", ed2: "copper kettle test 55", guest2: "quiet meadow test 6",
  other: "older lantern test 7", console: "console set test 88", same: "both tools test 99",
  wrong: ["not it at all 10", "still not it 11", "wrong again 12"],
};
export const ALL_VALUES = () => [V.lead, V.ed, V.guest, V.lead2, V.ed2, V.guest2, V.other, V.console, V.same, ...V.wrong];
export const uidOf = (key) => (key === "admin:leadership" ? TEST_UID : ACCOUNTS.find((a) => a.key === key).uid);
export const emailOf = (key) => ACCOUNTS.find((a) => a.key === key).email;
export const keysOf = (role) => ACCOUNTS.filter((a) => a.role === role).map((a) => a.key);

// ---- the static server ---------------------------------------------------------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
let SITE = null, server = null;
export async function startServer() {
  SITE = makeSite();
  server = http.createServer((req, res) => {
    const u = new URL(req.url, BASE);
    const name = u.pathname === "/" ? "/passwords.html" : decodeURIComponent(u.pathname);
    const file = path.join(SITE, name);
    if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
}
export const stopServer = () => new Promise((r) => (server ? server.close(r) : r()));

// ---- the emulators over REST ---------------------------------------------------
async function call(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...OWNER, ...(opts.headers || {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${opts.method || "GET"} ${url.replace(/\?.*/, "")} -> ${r.status}`);
  return text ? JSON.parse(text) : {};
}
const docUrl = `${FS}/v1/projects/${PROJECT}/databases/(default)/documents/vault/main`;
export async function reset(values = { leadership: V.lead, ed: V.ed, guest: V.guest }) {
  await call(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await call(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  const rules = fs.readFileSync(path.join(SITE, "passwords", "firestore.rules"), "utf8");
  await call(`${FS}/emulator/v1/projects/${PROJECT}:securityRules`, { method: "PUT", body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: rules }] } }) });
  for (const a of ACCOUNTS)
    await call(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`, { method: "POST",
      body: JSON.stringify({ email: a.email, password: values[a.role], localId: uidOf(a.key), emailVerified: true }) });
}
export const setPassword = (key, password) => call(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, { method: "POST", body: JSON.stringify({ localId: uidOf(key), password }) });
export const setDisabled = (key, on) => call(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, { method: "POST", body: JSON.stringify({ localId: uidOf(key), disableUser: on }) });
// does this account accept this value? (and is it the pinned account)
export async function accepts(key, password) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: emailOf(key), password, returnSecureToken: true }) });
  if (!r.ok) return false;
  return (await r.json()).localId === uidOf(key);
}
// the raw vault document (owner, rules bypassed), or null
export async function rawVault() {
  const r = await fetch(docUrl, { headers: OWNER });
  if (r.status === 404) return null;
  const d = await r.json();
  const f = d.fields;
  return { v: Number(f.v.integerValue), gen: Number(f.gen.integerValue), updatedAt: f.updatedAt,
    locks: (f.locks.arrayValue.values || []).map((x) => { const m = x.mapValue.fields; return { salt: m.salt.stringValue, iter: Number(m.iter.integerValue), iv: m.iv.stringValue, ct: m.ct.stringValue }; }),
    text: JSON.stringify(d) };
}
export async function openRaw(password) { const d = await rawVault(); return d ? openVault(d, password) : null; }
// a vault sealed in Node with lockPassword, written with the rules bypassed
export async function seedVault(roles, { lockPassword = roles.leadership, gen = 1, pending = null } = {}) {
  const lock = await makeLock(lockPassword);
  const locks = await seal({ roles, pending, changedAt: { leadership: "2026-10-01T12:00:00.000Z", ed: null, guest: null } }, [lock], gen);
  const fields = { v: { integerValue: "1" }, gen: { integerValue: String(gen) }, updatedAt: { timestampValue: new Date().toISOString() },
    locks: { arrayValue: { values: locks.map((l) => ({ mapValue: { fields: { salt: { stringValue: l.salt }, iter: { integerValue: String(l.iter) }, iv: { stringValue: l.iv }, ct: { stringValue: l.ct } } } })) } } };
  await call(docUrl, { method: "PATCH", body: JSON.stringify({ fields }) });
}

// ---- browsers ------------------------------------------------------------------
export const KINDS = {
  chromium: { name: "Chromium 1280", launch: () => chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) }),
    context: { viewport: { width: 1280, height: 900 } } },
  webkit: { name: "WebKit iPhone 13", launch: () => webkit.launch({ headless: true }),
    context: { ...devices["iPhone 13"] } },
};
export const browsersToRun = () => (process.env.FLOW_BROWSERS || "chromium,webkit").split(",").map((s) => s.trim()).filter(Boolean);

// Watches what the page logs, every policy violation, every request that leaves
// 127.0.0.1 or gstatic, and every Auth emulator call (for the order checks).
const INIT = `(() => {
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI));
  let hidden = false;
  try {
    Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get() { return hidden ? "hidden" : "visible"; } });
    Object.defineProperty(Document.prototype, "hidden", { configurable: true, get() { return hidden; } });
  } catch (e) {}
  window.__setHidden = (h) => { hidden = h; document.dispatchEvent(new Event("visibilitychange")); };
})();`;

export async function newPage(browser, kind, { scheme = "light", clock = false } = {}) {
  const k = KINDS[kind];
  const ctx = await browser.newContext({ ...k.context, colorScheme: scheme, locale: "en-CA", timezoneId: "America/Toronto" });
  if (kind === "chromium") await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const log = { console: [], errors: [], outside: [], auth: [] };
  page.on("console", (m) => log.console.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => log.errors.push(String(e && e.message)));
  await ctx.route("**/*", async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith("https://www.gstatic.com/firebasejs/10.12.2/")) return route.fulfill({ status: 200, contentType: "text/javascript", body: await sdkFile(url) });
    if (url.startsWith(BASE) || url.startsWith(FS) || url.startsWith(AUTH)) {
      if (url.startsWith(AUTH) && url.includes("identitytoolkit")) log.auth.push(authCall(url, req.postData()));
      if (page.__intercept) { const done = await page.__intercept(route, req); if (done) return; }
      return route.continue();
    }
    log.outside.push(url.replace(/\?.*/, ""));
    return route.abort();
  });
  if (clock) await page.clock.install();
  page.__log = log; page.__ctx = ctx; page.__kind = kind; page.__scheme = scheme;
  await page.goto(`${BASE}/passwords.html`);
  await page.waitForFunction("window.__edReady === true || window.__edFramed === true", null, { timeout: 20000 });
  return page;
}
export const closePage = async (p) => { try { await p.__ctx.close(); } catch { /* gone */ } };

// which account an Auth call was for (the email, or the email inside the token)
export function authCall(url, body) {
  const op = (url.match(/accounts:(\w+)/) || [])[1] || url.split("/").pop().replace(/\?.*/, "");
  let email = null;
  try {
    const b = JSON.parse(body || "{}");
    email = b.email || null;
    if (!email && b.idToken) email = JSON.parse(Buffer.from(b.idToken.split(".")[1], "base64url").toString("utf8")).email || null;
  } catch { /* not JSON */ }
  return { op, email, at: Date.now() };
}
export const callOf = (req) => authCall(req.url(), req.postData());

async function sdkFile(url) {
  const name = url.split("/").pop();
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`could not fetch ${name} from gstatic (${r.status})`);
  const body = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, body);
  return body;
}

// ---- driving the page ------------------------------------------------------------
export async function signIn(page, pw) {
  await page.fill("#gpw", pw);
  await page.click("#gbtn");
}
// the main view, after every row's quiet check finished
export async function onMain(page, timeout = 40000) {
  await page.waitForSelector("#app:not([hidden]) .pw-rows", { timeout });
  await page.waitForFunction(() => document.querySelector("#app").dataset.quiet === "done"
    && !document.querySelector("#app").textContent.includes("Checking with each tool"), null, { timeout });
}
export const gateText = (page) => page.$eval("#gerr", (e) => e.textContent);
export const rowText = (page, r) => page.$eval(`#row-${r}`, (e) => e.textContent.replace(/\s+/g, " "));
export const rowButton = (page, r, act) => page.locator(`#row-${r} button[data-act="${act}"]`);
export async function waitDialog(page, title, timeout = 60000) {
  await page.waitForFunction((t) => !document.querySelector("#flowWrap").hidden && document.querySelector("#flowTitle").textContent === t, title, { timeout });
}
export const dialogTitle = (page) => page.$eval("#flowTitle", (e) => (document.querySelector("#flowWrap").hidden ? "" : e.textContent));
export const dialogText = (page) => page.$eval("#flowBody", (e) => e.textContent.replace(/\s+/g, " "));
export async function dialogClick(page, label) {
  const b = page.locator("#flowBtns button", { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
  await b.click();
}
export const dialogOpen = (page) => page.$eval("#flowWrap", (e) => !e.hidden);
// type a new password twice and Save
export async function saveNew(page, value, repeat = value) {
  await page.fill("#pwNew", value);
  await page.fill("#pwRep", repeat);
  await dialogClick(page, "Save");
}
export async function changeRole(page, role, value) {
  await rowButton(page, role, "change").click();
  await waitDialog(page, `New ${{ leadership: "Leadership", ed: "ED", guest: "Guest" }[role]} password`);
  await saveNew(page, value);
}

// nothing the page could have written holds a value: both storages, every
// IndexedDB store, the console, the address, cookies
export async function leaks(page, values = ALL_VALUES()) {
  const where = await page.evaluate(async () => {
    const out = { storage: "", idb: "", url: location.href, cookie: document.cookie };
    try { out.storage = JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }); } catch { out.storage = "blocked"; }
    try {
      if (indexedDB.databases) {
        const parts = [];
        for (const d of await indexedDB.databases()) {
          const db = await new Promise((res, rej) => { const r = indexedDB.open(d.name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
          for (const s of db.objectStoreNames) {
            const all = await new Promise((res) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => res([]); });
            parts.push(`${d.name}/${s}:${JSON.stringify(all)}`);
          }
          db.close();
        }
        out.idb = parts.join("\n");
      }
    } catch (e) { out.idb = "error " + e; }
    return out;
  });
  const found = [];
  const text = { ...where, console: page.__log.console.join("\n"), errors: page.__log.errors.join("\n") };
  for (const [k, t] of Object.entries(text)) for (const v of values) if (String(t).includes(v)) found.push(k);
  return [...new Set(found)];
}
// the page broke none of its own rules
export async function pageProblems(page, { allowConsole = [] } = {}) {
  const csp = await page.evaluate(() => window.__csp || []).catch(() => []);
  const consoleErrors = page.__log.console.filter((m) => m.startsWith("error:"))
    .filter((m) => !/Failed to load resource|status of 400/.test(m))
    .filter((m) => !allowConsole.some((re) => re.test(m)));
  return [...csp.map((c) => `policy: ${c}`), ...page.__log.errors.map((e) => `pageerror: ${e}`), ...page.__log.outside.map((u) => `outside request: ${u}`), ...consoleErrors];
}
export const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
