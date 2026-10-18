// ============================================================================
//  The ED tools passwords page (design B.6): sign-in, the three rows, and the
//  dialogs. Every rule of a change lives in core.js; every word it can show
//  comes from there too where it exists. This file only paints and asks.
//
//  Kept in memory only, and only while signed in: the opened vault (keys and
//  the three values) and what is typed into a dialog. Never in storage, the
//  URL, the console, or any attribute of the page. A reload, Log out, 10
//  minutes without use (no change running) or 5 minutes in the background
//  drops it all and shows the gate again.
// ============================================================================
import { CONFIGS, ADMIN_FIREBASE } from "./config.js?v=3";
import * as C from "./core.js?v=3";
import { makeStore, firestoreLite, SDK_BASE } from "./store.js?v=3";
import { escapeHtml as h, ss, ls, flowDialog, isTouch, announce, enterMovesOn } from "./util.js?v=3";

// The test build points every app at the local emulators by replacing the
// next line (passwords/tests/make-site.mjs). Live it is always null.
const EMULATORS = null;

const $ = (id) => document.getElementById(id);
const DOTS = "•".repeat(10);
const dotsHtml = `<span aria-hidden="true">${DOTS}</span><span class="pw-sr">hidden</span>`;
const ROW_INFO = {
  leadership: "Physician Hiring for admins, Motion Voting settings and the Patient Hub statistics page.",
  ed: "Physician Hiring for the committee, and Motion Voting.",
  guest: "Physician Hiring, for applicants to book their times.",
};
const OUT_KEY = "ed_pw_out";
const OUT_TEXT = { idle: C.TEXT.idleOut, hidden: C.TEXT.hiddenOut, "signed-out": C.TEXT.signedOut, logout: C.TEXT.loggedOut };
const iso = () => new Date().toISOString();
const toolOf = (key) => C.TOOL_OF[C.ACCOUNTS.find((a) => a.key === key).project];
const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1);

let FB = null;            // { app, auth, au, sdk, db, fs }
let S = null;             // { store, guard, adapter, session, mainValue (first use only) }
let Q = null;             // the quiet check: { checked: Set, status: {}, stale: {}, finishing: [], stopped }
const shown = {};         // role -> timer while its value is on screen
const diffFrom = {};      // role -> { key: value } when a role's accounts differ (memory only)
const SEEN = new Set();   // every value a person typed in this tab: "in use" for a new one (round 1 m1)
let running = false;      // a change is running: no idle sign-out, leave-page warning
let leaving = false;
let lastUse = Date.now(), hiddenAt = null;

// ------------------------------------------------------------------ Firebase
async function firebase() {
  if (FB) return FB;
  let a, au, lite;
  try {
    [a, au] = await Promise.all([import(SDK_BASE + "firebase-app.js"), import(SDK_BASE + "firebase-auth.js")]);
  } catch { throw Object.assign(new Error("sdk"), { code: "app/sdk-unreachable" }); }
  const app = a.initializeApp(ADMIN_FIREBASE, "ed-pw-main");
  // this page's own sign-in in memory only, like every helper (B.5.2)
  const auth = au.initializeAuth(app, { persistence: au.inMemoryPersistence });
  if (EMULATORS) au.connectAuthEmulator(auth, EMULATORS.auth, { disableWarnings: true });
  try { lite = await firestoreLite(app, { emulator: EMULATORS && EMULATORS.firestore }); }
  catch { throw Object.assign(new Error("sdk"), { code: "app/sdk-unreachable" }); }
  const sdk = {
    initializeApp: a.initializeApp, deleteApp: a.deleteApp, initializeAuth: au.initializeAuth, inMemoryPersistence: au.inMemoryPersistence,
    signInWithEmailAndPassword: au.signInWithEmailAndPassword, updatePassword: au.updatePassword, signOut: au.signOut,
    reauthenticateWithCredential: au.reauthenticateWithCredential, EmailAuthProvider: au.EmailAuthProvider,
  };
  FB = { app, auth, au, sdk, ...lite };
  return FB;
}
// every account value this tab knows differs from the saved one, any role
// (round 2 N-M1: Check first proves the other roles' accounts with these)
const knownValues = () => Object.assign({}, ...Object.values(diffFrom));
const ctx = (extra = {}) => ({ auth: S.adapter, session: S.session, guard: S.guard, now: iso, ...extra });

// ------------------------------------------------------------------ the gate
function gateMsg(text, kind = "") { const e = $("gerr"); e.textContent = text || ""; e.className = "pw-msg" + (kind ? ` is-${kind}` : ""); }
function gateCountdown() {
  const btn = $("gbtn"); if (!btn) return;
  const left = C.gatePausedFor(ls);
  if (!left) { if (btn.dataset.wait) { btn.disabled = false; btn.textContent = "Enter"; delete btn.dataset.wait; } return; }
  btn.dataset.wait = "1"; btn.disabled = true; btn.textContent = `Wait ${Math.ceil(left / 1000)} s`;
  setTimeout(gateCountdown, 500);
}
async function onGate(e) {
  e.preventDefault();
  const btn = $("gbtn"), field = $("gpw");
  const typed = field.value.trim();     // the gate trims the ends, like hiring
  if (btn.disabled || C.gatePausedFor(ls)) return;
  if (!typed) { gateMsg("Type the Admin password."); return; }
  btn.disabled = true; btn.textContent = "Signing in...";
  gateMsg("");
  let done = false;
  try { done = await unlock(typed); }
  finally {
    if (!done) { btn.disabled = false; btn.textContent = "Enter"; gateCountdown(); }
  }
}
async function unlock(typed) {
  let fb;
  try { fb = await firebase(); } catch (e) { gateMsg(C.signInError(e)); return false; }
  try { await C.signInGate(fb.sdk, fb.auth, typed); }
  catch (e) {
    if (C.isRefusal(e)) gateMsg(C.gateWrongText(C.gateWrong(ls)));
    else gateMsg(C.signInError(e));
    return false;
  }
  C.gateRight(ls);
  $("gpw").value = "";
  gateMsg(C.TEXT.opening, "busy");
  const store = makeStore(fb.fs, fb.db);
  let o;
  try { o = await C.openSession({ store, password: typed }); }
  catch {
    gateMsg(C.TEXT.noConnection);
    try { await fb.sdk.signOut(fb.auth); } catch { /* local anyway */ }
    return false;
  }
  S = { store, guard: C.makeGuard(), session: null, mainValue: null,
    adapter: C.makeFirebaseAdapter(fb.sdk, { mainAuth: fb.auth, configs: CONFIGS,
      connect: EMULATORS ? (auth) => fb.au.connectAuthEmulator(auth, EMULATORS.auth, { disableWarnings: true }) : null }) };
  watchSignOut();
  if (o.state === "open") { S.session = o.session; enterMain(); }
  else { S.mainValue = typed; enterFirstUse(o); }
  return true;
}

// Firebase signed this tab out (a password changed elsewhere, usually)
function watchSignOut() {
  FB.au.onAuthStateChanged(FB.auth, (u) => { if (!u && S && !leaving) signOut("signed-out"); });
}

// Drop everything and start again: a reload is the only sure way to clear
// memory. Only the reason (a word) is kept, to say why.
async function signOut(reason) {
  if (leaving) return;
  leaving = true;
  if (S && S.session) S.session.close();
  S = null;
  ss.set(OUT_KEY, reason);
  if (FB) { try { await Promise.race([FB.sdk.signOut(FB.auth), new Promise((r) => setTimeout(r, 2000))]); } catch { /* local anyway */ } }
  location.reload();
}

// ------------------------------------------------------------------ idle and hidden
function watchUse() {
  for (const ev of ["pointerdown", "keydown", "input", "wheel", "touchstart"]) document.addEventListener(ev, () => { lastUse = Date.now(); }, { passive: true, capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { hiddenAt = Date.now(); hideAll(); }
    else { checkIdle(); hiddenAt = null; lastUse = Date.now(); }
  });
  // back/forward cache: a page restored from it must not show anything; start again (round 1 m8)
  window.addEventListener("pageshow", (e) => { if (e.persisted) location.reload(); });
  setInterval(checkIdle, 5000);
}
function checkIdle() {
  if (!S || running || leaving) return;
  const now = Date.now();
  if (hiddenAt !== null && now - hiddenAt >= C.TIMING.hiddenMs) signOut("hidden");
  else if (now - lastUse >= C.TIMING.idleMs) signOut("idle");
}

// ------------------------------------------------------------------ main view
function showShell() {
  $("gate").hidden = true;
  $("top").hidden = false;
  $("app").hidden = false;
}
function enterMain(lead = "") {
  showShell();
  render(lead);
  runQuiet();
}

function pageMsg(text, kind = "bad") { const e = $("pageMsg"); if (e) { e.textContent = text || ""; e.className = `pw-msg pw-page-msg${kind ? ` is-${kind}` : ""}`; } }

function render(lead = "") {
  if (!S || !S.session) return;
  const keep = document.activeElement && document.activeElement.dataset ? { act: document.activeElement.dataset.act, role: document.activeElement.dataset.role } : null;
  $("app").innerHTML = `
    <p class="pw-intro">${h(C.TEXT.intro)}</p>
    <p id="pageMsg" class="pw-msg pw-page-msg" role="status">${h(lead)}</p>
    <ul class="ed-list pw-rows">${C.ROLES.map(rowHtml).join("")}</ul>
    <p class="pw-foot"><a href="./">All ED tools</a></p>`;
  for (const r of Object.keys(shown)) paintValue(r, true);
  if (Q && Q.stopped) pageMsg(C.TEXT.throttled, "warn");
  if (keep && keep.act) {
    const b = document.querySelector(`#app button[data-act="${keep.act}"][data-role="${keep.role}"]`);
    if (b && !b.disabled) b.focus();
  }
}

function rowHtml(r) {
  const c = S.session.content, p = c.pending, w = C.ROLE_WORD[r];
  const isPending = !!(p && p.role === r);
  const checking = !!Q && !Q.checked.has(r);
  const stale = !isPending && Q ? (Q.stale[r] || []) : [];
  const blocked = p && !isPending ? C.blockedBy(c, r) : "";
  let status = "", kind = "is-quiet", extra = "";
  let second = "";
  if (isPending) {
    status = C.pendingText(c); kind = "is-warn";
    const label = p.next ? "Finish the change" : "Go on";
    extra = `<button type="button" class="ed-btn ed-btn-filled" data-act="finish" data-role="${r}">${label}</button>`;
    if (C.canCancel(S.session)) extra += `<button type="button" class="ed-btn ed-btn-danger" data-act="cancel" data-role="${r}">Cancel this change</button>`;
    // an account of this role takes neither value: on the Finish line (round 1 m3)
    const stuck = Q ? Q.finishing.find((k) => C.accountsFor([r]).some((a) => a.key === k)) : null;
    if (stuck) {
      second = C.neitherText(stuck, !!p.next);   // round 2 m1: no field before Go on
      if (p.next) extra += `<button type="button" class="ed-btn ed-btn-tinted" data-act="fix" data-role="${r}" data-key="${h(stuck)}">Type the one in use</button>`;
    }
  } else if (diffFrom[r]) {
    // first use or the stale flow found the tools disagree (round 1 m5)
    status = C.staleRowText(r); kind = "is-bad";
    if (blocked) second = blocked;
  } else if (stale.length) {
    status = C.staleText(stale[0]); kind = "is-bad";
    // while another change is pending, it has to be finished first (round 1 m4)
    if (blocked) second = blocked;
    else extra = `<button type="button" class="ed-btn ed-btn-filled" data-act="stale" data-role="${r}" data-key="${h(stale[0])}">Type the one in use</button>`;
  } else if (blocked) {
    status = blocked;
  } else if (checking) {
    status = "Checking with each tool...";
  }
  const changeOff = isPending || !!blocked || checking || (stale.length > 0 && !diffFrom[r]);
  const changeLabel = diffFrom[r] && !isPending ? `Set a new ${w} password` : "Change";
  const changed = C.longDay(c.changedAt && c.changedAt[r]);
  return `<li class="pw-row" id="row-${r}">
      <div class="pw-row-head"><h2 class="pw-name">${w}</h2><span class="pw-value" id="val-${r}">${dotsHtml}</span></div>
      <p class="ed-hint">${h(ROW_INFO[r])}</p>
      ${changed ? `<p class="ed-hint">Changed ${h(changed)}</p>` : ""}
      ${status ? `<p class="pw-status ${kind}">${h(status)}</p>` : ""}
      ${second ? `<p class="pw-status ${isPending ? "is-bad" : "is-quiet"}">${h(second)}</p>` : ""}
      <p class="pw-status is-quiet" id="copyNote-${r}" hidden></p>
      <div class="pw-actions">
        <button type="button" class="ed-btn ed-btn-tinted" data-act="show" data-role="${r}" aria-label="Show the ${w} password">Show</button>
        <button type="button" class="ed-btn ed-btn-tinted" data-act="copy" data-role="${r}" aria-label="Copy the ${w} password">Copy</button>
        <button type="button" class="ed-btn ${diffFrom[r] && !isPending ? "ed-btn-filled" : "ed-btn-tinted"}" data-act="change" data-role="${r}"${changeOff ? " disabled" : ""}${changeLabel === "Change" ? ` aria-label="Change the ${w} password"` : ""}>${h(changeLabel)}</button>
        ${extra}
      </div>
    </li>`;
}

// a value on screen: 30 seconds, until Hide, or until the tab is hidden
function paintValue(r, on) {
  const el = $("val-" + r), b = document.querySelector(`#app button[data-act="show"][data-role="${r}"]`);
  if (!el || !b) return;
  const w = C.ROLE_WORD[r];
  if (on && S && S.session) { el.textContent = S.session.content.roles[r]; b.textContent = "Hide"; b.setAttribute("aria-label", `Hide the ${w} password`); }
  else { el.innerHTML = dotsHtml; b.textContent = "Show"; b.setAttribute("aria-label", `Show the ${w} password`); }
}
function showValue(r, on) {
  clearTimeout(shown[r]); delete shown[r];
  if (on) shown[r] = setTimeout(() => showValue(r, false), C.TIMING.showMs);
  paintValue(r, on);
}
// the tab went to the background: every value on screen goes back to dots,
// and every field shown as text goes back to a password field (round 1 m7)
function hideAll() {
  for (const r of C.ROLES) if (shown[r]) showValue(r, false);
  document.querySelectorAll("button[data-show]").forEach((b) => {
    const el = $(b.dataset.show);
    if (el && el.type !== "password") { el.type = "password"; b.textContent = "Show"; b.setAttribute("aria-label", b.getAttribute("aria-label").replace(/^Hide/, "Show")); }
  });
  const fin = $("finVal");
  if (fin && fin.dataset.on) showFinish(false);
}

async function copyValue(r, btn) {
  const v = S.session.content.roles[r];
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("no clipboard");
    await navigator.clipboard.writeText(v);
    btn.textContent = "Copied";
    setTimeout(() => { if (btn.isConnected) btn.textContent = "Copy"; }, C.TIMING.copiedMs);
  } catch {
    // blocked: show it and select it, so it can be copied by hand
    showValue(r, true);
    const el = $("val-" + r), sel = window.getSelection(), range = document.createRange();
    range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range);
    const note = $("copyNote-" + r);
    if (note) { note.textContent = "This browser didn't let the page copy it. It is selected: copy it yourself."; note.hidden = false; note.scrollIntoView({ block: "nearest" }); }
  }
}

function onAppClick(e) {
  const b = e.target.closest("button[data-act]");
  if (!b || b.disabled || !S || !S.session) return;
  const r = b.dataset.role;
  if (b.dataset.act === "show") showValue(r, !shown[r]);
  else if (b.dataset.act === "copy") copyValue(r, b);
  else if (b.dataset.act === "change") openChange(r);
  else if (b.dataset.act === "finish") openFinish();
  else if (b.dataset.act === "cancel") openCancel();
  else if (b.dataset.act === "stale") openStale(r, b.dataset.key);
  else if (b.dataset.act === "fix") flowDialog((ctl) => stepFix(ctl, r, b.dataset.key), { onClose: () => render() });
}

// ------------------------------------------------------------------ the quiet check (B.6.4)
async function runQuiet() {
  Q = { checked: new Set(), status: {}, stale: {}, finishing: [], stopped: null };
  $("app").dataset.quiet = "running";   // "done" when every row was checked
  render();
  for (const r of C.ROLES) {
    if (!S || !S.session) return;
    let out = null;
    try { out = await C.quietCheck(ctx(), { roles: [r], onResult: (x) => { if (Q) Q.status[x.key] = x.ok ? "ok" : x.why; } }); }
    catch { out = null; }
    if (!S || !S.session || !Q) return;
    if (out) {
      if (out.stale[r] && !diffFrom[r]) Q.stale[r] = out.stale[r];
      Q.finishing.push(...out.finishing);
      if (out.stopped) Q.stopped = out.stopped;
    }
    Q.checked.add(r);
    if (Q.stopped) break;
    if (!document.querySelector("#flowWrap:not([hidden])")) render();
  }
  if (Q.stopped) for (const r of C.ROLES) Q.checked.add(r);
  $("app").dataset.quiet = "done";
  if (!document.querySelector("#flowWrap:not([hidden])")) render();
}
// after a role was set right: its accounts are fine now
function roleIsFine(r) {
  if (!Q) return;
  delete Q.stale[r]; delete diffFrom[r];
  Q.finishing = Q.finishing.filter((k) => !C.accountsFor([r]).some((a) => a.key === k));
  for (const a of C.accountsFor([r])) Q.status[a.key] = "ok";
}

// ------------------------------------------------------------------ dialog pieces
// (in a dialog the live region reads it out; round 1 m2)
const msgLine = `<p id="pwErr" class="pw-msg"></p>`;
// a password field with its Show button. Nothing is remembered or corrected
// (round 1 m6); key: what Return does on a phone keyboard, "next" or "go".
const field = (id, label, { hint = "", key = "go" } = {}) => `<div><label class="ed-label" for="${id}">${h(label)}</label>
  <div class="pw-field"><input id="${id}" class="ed-field" type="password" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="${key}"${hint ? ` aria-describedby="${id}Hint"` : ""}>
  <button type="button" class="ed-btn ed-btn-tinted" data-show="${id}" aria-label="Show ${h(label)}">Show</button></div>
  ${hint ? `<p id="${id}Hint" class="ed-hint">${h(hint)}</p>` : ""}</div>`;
const val = (id) => { const el = $(id); return el ? el.value : ""; };
function wireShow(body) {
  body.querySelectorAll("button[data-show]").forEach((b) => b.addEventListener("click", () => {
    const el = $(b.dataset.show); if (!el) return;
    const on = el.type === "password";
    el.type = on ? "text" : "password";
    b.textContent = on ? "Hide" : "Show";
    b.setAttribute("aria-label", b.getAttribute("aria-label").replace(/^(Show|Hide)/, on ? "Hide" : "Show"));
  }));
}
// the message at the top of the step; the field to fix is marked, and only
// focused on a computer (on a phone the keyboard would cover the message)
// the open dialog's message line, else the first-use form's
const msgEl = () => document.querySelector("#flowWrap:not([hidden]) #pwErr") || $("fuErr");
function showErr(errs, fieldId = null) {
  const el = msgEl(); if (!el) return;
  const scope = el.closest("#flowBody, form") || document;
  const inDialog = !!el.closest("#flowWrap");
  el.className = "pw-msg";
  if (!inDialog) el.setAttribute("role", "alert");
  el.textContent = "";
  [].concat(errs).forEach((t, i) => { if (i) el.appendChild(document.createElement("br")); el.appendChild(document.createTextNode(t)); });
  if (inDialog) announce([].concat(errs).join(" "));
  scope.querySelectorAll('[aria-invalid="true"]').forEach((x) => x.removeAttribute("aria-invalid"));
  const f = fieldId && $(fieldId);
  if (f) f.setAttribute("aria-invalid", "true");
  if (f && !isTouch()) f.focus({ preventScroll: true });
  else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  el.scrollIntoView({ block: "start" });
}
function showBusy(text, kind = "busy") {
  const el = msgEl(); if (!el) return;
  el.className = `pw-msg is-${kind}`;
  if (el.closest("#flowWrap")) announce(text); else el.setAttribute("role", "status");
  el.textContent = text;
}
// a whole step of one message and one button
function stepNote(ctl, title, text, kind = "", buttons = null) {
  ctl.step({ title, html: `<p class="pw-msg${kind ? ` is-${kind}` : ""}">${h(text)}</p>`,
    buttons: buttons || [{ label: "Close", kind: "filled", run: (c) => c.close(null) }] });
}
const beforeUnload = (e) => { e.preventDefault(); e.returnValue = ""; };

// ------------------------------------------------------------------ Change (B.6.3)
function openChange(r, lead = "") {
  if (!S || !S.session) return;
  const from = diffFrom[r] || {};
  flowDialog((ctl) => stepNew(ctl, r, from, lead), { onClose: () => render() });
}

function stepNew(ctl, r, from, lead = "") {
  const w = C.ROLE_WORD[r];
  const warn = C.changeWarnings(r);
  ctl.step({ title: `New ${w} password`, html: `${msgLine}
      ${lead ? `<p class="pw-msg is-bad">${h(lead)}</p>` : ""}
      ${field("pwNew", `New ${w} password`, { hint: C.TEXT.hint, key: "next" })}
      ${field("pwRep", "Type it again")}
      ${warn.map((t) => `<p class="ed-hint">${h(t)}</p>`).join("")}
      <p class="ed-hint">${h(C.TEXT.keepOpen)}</p>`,
    wire: wireShow,
    buttons: [
      { label: "Cancel", kind: "tinted", run: (c) => c.close(null) },
      { label: "Save", kind: "filled", id: "pwSave", run: (c, btn) => {
        const v = val("pwNew"), rep = val("pwRep");
        const errs = C.validateChange(S.session.content, r, v, rep, from, SEEN);
        if (errs.length) { showErr(errs, /don't match/.test(errs[0]) ? "pwRep" : "pwNew"); return; }
        btn.disabled = true;
        runFlow(ctl, r, (x) => C.changePassword(x, r, v, { from, known: knownValues() }), { from, value: v });
      } },
    ] });
}

// Run a change (or Finish) with the per-account list, then say how it went.
async function runFlow(ctl, r, start, again = {}) {
  const w = C.ROLE_WORD[r], accts = C.accountsFor([r]);
  const state = Object.fromEntries(accts.map((a) => [a.key, "wait"]));
  const p0 = S.session.content.pending;
  if (p0) for (const k of p0.done || []) state[k] = "done";
  let verifying = false, first = true, say = null;
  const paint = (text = C.TEXT.keepOpen) => {
    // read out the whole step once, then only the account that just changed (round 2 m2)
    ctl.step({ title: `Changing the ${w} password`, focus: first, say: first ? undefined : say || false, html: `<p id="pwErr" class="pw-msg is-busy">${h(text)}</p>
      <ul class="pw-steps">${accts.map((a) => `<li class="is-${state[a.key]}">${h(a.label)}: ${state[a.key] === "done" ? "changed" : state[a.key] === "now" ? "changing..." : "waiting"}</li>`).join("")}</ul>
      ${verifying ? `<p class="ed-hint">Checking each tool takes the new password...</p>` : ""}` });
    first = false;
  };
  paint("Checking each tool first. Nothing is changed yet.");
  ctl.sticky = true; running = true;
  window.addEventListener("beforeunload", beforeUnload);
  let res = null, thrown = null;
  try {
    res = await start(ctx({ onProgress: (p) => {
      say = null;
      for (const a of accts) {
        const was = state[a.key];
        state[a.key] = p.done.includes(a.key) ? "done" : p.inProgress === a.key ? "now" : was === "done" ? "done" : "wait";
        if (was !== "done" && state[a.key] === "done") say = `${a.label}: changed`;
      }
      if (p.verifying && !verifying) say = "Checking each tool takes the new password.";
      if (p.verifying) verifying = true;
      paint();
    } }));
  } catch (e) { thrown = e; }
  finally { ctl.sticky = false; running = false; window.removeEventListener("beforeunload", beforeUnload); lastUse = Date.now(); }
  if (!S || !S.session) return;
  const err = thrown || (res && !res.ok ? res.error : null);
  const code = String((err && err.code) || "");
  if (code === "changed-elsewhere") return elsewhere(ctl);
  if (code === "locked-out" || code === "signed-out") return signOut("signed-out");
  if (thrown) {
    if (code === "invalid" && again.from) return stepNew(ctl, r, again.from, (thrown.errors || [thrown.message])[0]);
    if (code === "pending-other") return stepNote(ctl, "Nothing was changed", thrown.message, "bad");
    return stepNote(ctl, "Nothing was changed", C.TEXT.noSave, "bad");
  }
  if (res.ok) { roleIsFine(r); return stepDone(ctl, r); }
  if (res.stage === "check") {
    const bad = res.results[res.results.length - 1];
    // (Check first also proves the other roles' hiring accounts: round 1 m1)
    if (bad.why === "refused") return stepStale(ctl, C.ACCOUNTS.find((a) => a.key === bad.key).role, bad.key, {}, true);
    return stepNote(ctl, "Nothing was changed", C.checkFailText(bad.why, bad.key), "bad");
  }
  if (code === "refused" && res.failedAt) return stepFix(ctl, r, res.failedAt);
  const lines = C.halfDoneText([r], res.done || []);
  ctl.step({ title: "Not finished", html: `<p class="pw-msg">${h(C.failureText(err, res.failedAt))}</p>
      ${lines.map((t) => `<p>${h(t)}</p>`).join("")}
      <p class="ed-hint">It can be finished from any device: open this page and press Finish the change.</p>`,
    buttons: [{ label: "Close", kind: "tinted", run: (c) => c.close(null) },
      { label: "Finish the change", kind: "filled", run: (c) => runFlow(c, r, (x) => C.finishChange(x)) }] });
}

async function elsewhere(ctl) {
  const before = S.session.content ? JSON.parse(JSON.stringify(S.session.content)) : null;
  try { await S.session.reload(); }
  catch (e) { if (e && e.code === "locked-out") return signOut("signed-out"); }
  // forget what this tab knew about any role that moved, and check again (round 3)
  const moved = C.movedRoles(before, S.session.content).filter((r) => diffFrom[r] || (Q && Q.stale[r]));
  for (const r of moved) { delete diffFrom[r]; if (Q) delete Q.stale[r]; }
  stepNote(ctl, "Changed on another device", C.TEXT.changedElsewhere, "");
  if (moved.length) runQuiet();
}

function stepDone(ctl, r) {
  const d = C.doneText(r);
  ctl.step({ title: "Done", html: `<p class="pw-msg is-good">${h(d.works)}</p>
      <p><strong>${h(d.tell)}</strong></p>
      <div><label class="ed-label" for="pwNote">A message without the password</label>
      <textarea id="pwNote" class="ed-field pw-note" rows="3" readonly>${h(d.note)}</textarea></div>`,
    focus: false,
    buttons: [{ label: "Copy the message", kind: "tinted", run: async (c, btn) => {
      try { await navigator.clipboard.writeText(d.note); btn.textContent = "Copied"; }
      catch { const t = $("pwNote"); t.focus(); t.select(); btn.textContent = "Selected: copy it"; }
    } }, { label: "Close", kind: "filled", run: (c) => c.close(null) }] });
  $("flowTitle").focus();
}

// Part way, an account takes neither value: type the one in use (pending.from)
function stepFix(ctl, r, key) {
  const w = C.ROLE_WORD[r];
  ctl.step({ title: "Not finished", html: `${msgLine}
      <p>${h(C.failureText({ code: "refused" }, key))}</p>
      ${field("pwFix", `${w} password used by ${capital(toolOf(key))}`)}`,
    wire: wireShow,
    buttons: [{ label: "Close", kind: "tinted", run: (c) => c.close(null) },
      { label: "Check", kind: "filled", run: async (c, btn) => {
        const typed = val("pwFix");
        if (!typed) { showErr(["Type the password."], "pwFix"); return; }
        SEEN.add(typed);
        btn.disabled = true; showBusy("Checking...");
        let out;
        try { out = await C.fixAccount(ctx(), key, typed); } catch (e) { btn.disabled = false; if (e && e.code === "changed-elsewhere") return elsewhere(c); showErr([C.TEXT.noSave]); return; }
        btn.disabled = false;
        if (out.outcome === "refused") { showErr([C.TEXT.typedWrong], "pwFix"); return; }
        if (out.outcome === "throttled") { showErr([C.TEXT.throttled]); return; }
        if (out.outcome === "error") { showErr([C.TEXT.noConnection]); return; }
        runFlow(c, r, (x) => C.finishChange(x));
      } }] });
}

// ------------------------------------------------------------------ Finish, Go on, Cancel (B.5.4)
function openFinish() {
  const p = S.session.content.pending; if (!p) return;
  flowDialog((ctl) => {
    if (p.next) stepFinish(ctl);
    else stepGoOn(ctl);
  }, { onClose: () => render() });
}
// Before Finish runs, say what it sets the password to (hidden until Show), so
// a change nobody here started can be spotted and cancelled (round 1 m1, security)
let finTimer = null;
function showFinish(on) {
  const el = $("finVal"), b = $("finShow"), p = S && S.session && S.session.content.pending;
  clearTimeout(finTimer);
  if (!el || !b) return;
  if (on) finTimer = setTimeout(() => showFinish(false), C.TIMING.showMs);   // like the rows (round 2 m5)
  if (on && p && p.next) { el.textContent = p.next; el.dataset.on = "1"; b.textContent = "Hide"; b.setAttribute("aria-label", "Hide the new password"); }
  else { el.innerHTML = dotsHtml; delete el.dataset.on; b.textContent = "Show"; b.setAttribute("aria-label", "Show the new password"); }
}
function stepFinish(ctl) {
  const p = S.session.content.pending, w = C.ROLE_WORD[p.role];
  const buttons = [{ label: "Close", kind: "tinted", run: (c) => c.close(null) }];
  if (C.canCancel(S.session)) buttons.push({ label: "Cancel this change", kind: "danger", run: (c) => stepCancel(c) });
  buttons.push({ label: "Finish the change", kind: "filled", run: (c) => runFlow(c, p.role, (x) => C.finishChange(x)) });
  ctl.step({ title: "Finish the change", html: `${msgLine}<p>${h(C.pendingText(S.session.content))}</p>
      <p>This sets the ${w} password to:</p>
      <div class="pw-row-head"><span class="pw-value" id="finVal">${dotsHtml}</span>
      <button type="button" class="ed-btn ed-btn-tinted" id="finShow" aria-label="Show the new password">Show</button></div>
      <p class="ed-hint">If nobody here started this change, cancel it if you can, and ask the person who looks after the ED tools.</p>`,
    wire: (body) => { body.querySelector("#finShow").addEventListener("click", () => showFinish(!$("finVal").dataset.on)); },
    buttons });
}
function stepGoOn(ctl) {
  const buttons = [{ label: "Close", kind: "tinted", run: (c) => c.close(null) }];
  if (C.canCancel(S.session)) buttons.push({ label: "Cancel this change", kind: "danger", run: (c) => stepCancel(c) });
  buttons.push({ label: "Go on", kind: "filled", run: async (c, btn) => {
    const typed = val("pwNext");
    if (!typed) { showErr(["Type the new Admin password."], "pwNext"); return; }
    SEEN.add(typed);
    btn.disabled = true; showBusy(C.TEXT.opening);
    try { await S.session.unlockNext(typed); }
    catch (e) { btn.disabled = false; showErr([e && e.code === "not-next" ? C.TEXT.notNext : C.TEXT.noConnection], "pwNext"); return; }
    runFlow(c, "leadership", (x) => C.finishChange(x));
  } });
  ctl.step({ title: "Go on with the Admin change", html: `${msgLine}<p>${h(C.TEXT.goOn)}</p>${field("pwNext", "New Admin password")}`,
    wire: wireShow, buttons });
}
function openCancel() { flowDialog((ctl) => stepCancel(ctl), { onClose: () => render() }); }
function stepCancel(ctl) {
  const p = S.session.content.pending; if (!p) return ctl.close(null);
  ctl.step({ title: `Cancel the ${C.ROLE_WORD[p.role]} change?`, html: `${msgLine}<p>${h(C.TEXT.cancelAsk)}</p>`,
    buttons: [{ label: "Keep it", kind: "tinted", run: (c) => c.close(null) },
      { label: "Cancel the change", kind: "danger", run: async (c, btn) => {
        btn.disabled = true;
        try { await C.cancelChange(ctx()); }
        catch (e) {
          btn.disabled = false;
          if (e && e.code === "changed-elsewhere") return elsewhere(c);
          showErr([e && e.code === "cannot-cancel" ? e.message : C.TEXT.noSave]); return;
        }
        stepNote(c, "Cancelled", `The ${C.ROLE_WORD[p.role]} password was not changed anywhere.`, "good");
      } }] });
}

// ------------------------------------------------------------------ stale (B.5.5)
function openStale(r, key) { flowDialog((ctl) => stepStale(ctl, r, key, {}, false), { onClose: () => render() }); }
function stepStale(ctl, r, key, known, fromChange) {
  const w = C.ROLE_WORD[r];
  ctl.step({ title: `The ${w} password in use`, html: `${msgLine}
      <p>${h(C.staleText(key))}</p>
      ${field("pwTyped", `${w} password used by ${capital(toolOf(key))}`)}`,
    wire: wireShow,
    buttons: [{ label: "Cancel", kind: "tinted", run: (c) => c.close(null) },
      { label: "Check", kind: "filled", run: async (c, btn) => {
        const typed = val("pwTyped");
        if (!typed) { showErr(["Type the password."], "pwTyped"); return; }
        SEEN.add(typed);
        btn.disabled = true; showBusy("Checking...");
        let res;
        try { res = await C.checkTyped(ctx(), r, key, typed, { status: (Q && Q.status) || {}, known }); }
        catch (e) { btn.disabled = false; showErr([e && /^pending/.test(e.code) ? e.message : C.TEXT.noConnection]); return; }
        btn.disabled = false;
        const o = res.outcome;
        if (o === "refused") return showErr([C.TEXT.typedWrong], "pwTyped");
        if (o === "throttled") return showErr([C.TEXT.throttled]);
        if (o === "error") return showErr([C.TEXT.noConnection]);
        if (o === "need-more") return stepStale(c, r, res.keys[0], res.known, fromChange);
        if (o === "ok") { roleIsFine(r); return stepNote(c, "Nothing to change", C.TEXT.sameAsSaved, "good"); }
        if (o === "save") {
          try { await C.saveStale(ctx(), r, res.value); }
          catch (e) { if (e && e.code === "changed-elsewhere") return elsewhere(c); return showErr([C.TEXT.noSave]); }
          roleIsFine(r);
          return stepNote(c, "Saved", C.TEXT.savedStale, "good");
        }
        // the role's accounts differ, or it is the same as another role: set a new one now
        diffFrom[r] = res.from;
        if (Q) delete Q.stale[r];
        return stepNew(c, r, res.from, o === "same-as-other" ? C.sameAsText(r, res.otherRole) : C.differText(r, res.from));
      } }] });
}

// ------------------------------------------------------------------ first use and recovery (B.5.6)
const FU = { overrides: {}, proven: {}, expectGen: 0 };
function enterFirstUse(o) {
  showShell();
  FU.expectGen = o.expectGen; FU.overrides = {}; FU.proven = {};
  const broken = o.state === "locked" && o.expectGen === null;
  const text = o.state === "first-use" ? C.TEXT.firstUse : o.reason === "refused" ? C.TEXT.refusedDoc : C.TEXT.recovery;
  $("app").innerHTML = `
    <p class="pw-intro">${h(C.TEXT.intro)}</p>
    <section class="ed-card" aria-labelledby="fuTitle">
      <h2 id="fuTitle" class="pw-card-title">${o.state === "first-use" ? "First time here" : "Make a new saved copy"}</h2>
      ${broken ? `<p class="pw-msg" role="alert">${h(C.TEXT.brokenCopy)}</p>` : `
      <p>${h(text.replace(/^First time here\. /, ""))}</p>
      <form id="fuForm" class="pw-form" autocomplete="off" novalidate>
        <p id="fuErr" class="pw-msg" role="alert"></p>
        ${field("fuEd", "ED password in use now", { key: "next" })}
        ${field("fuGuest", "Guest password in use now")}
        <button id="fuGo" class="ed-btn ed-btn-filled" type="submit">Check and save</button>
      </form>`}
    </section>
    <p class="pw-foot"><a href="./">All ED tools</a></p>`;
  const form = $("fuForm");
  if (!form) return;
  wireShow(form);
  enterMovesOn(form);
  form.addEventListener("submit", (e) => { e.preventDefault(); firstUseGo(); });
  if (!isTouch()) $("fuEd").focus();
}
async function firstUseTry() {
  const typed = { ed: val("fuEd"), guest: val("fuGuest") };
  const res = await C.firstUse({ auth: S.adapter, store: S.store, guard: S.guard, mainValue: S.mainValue, expectGen: FU.expectGen }, typed,
    { overrides: FU.overrides, proven: FU.proven });
  FU.proven = res.proven || FU.proven;
  return res;
}
async function firstUseGo() {
  const btn = $("fuGo"); if (!btn || btn.disabled) return;
  btn.disabled = true; showBusy("Checking each tool. This takes a few seconds.");
  let res = null;
  try { res = await firstUseTry(); } catch (e) { res = { thrown: e }; }
  btn.disabled = false;
  if (res.outcome === "refused") return askFirstUse(res.keys[0]);
  return firstUseDone(res);
}
// what first use came to, shown on its form (or the main view once saved)
async function firstUseDone(res) {
  if (res.thrown) {
    if (res.thrown.code === "changed-elsewhere") {
      // another device saved first: open that copy
      const o = await C.openSession({ store: S.store, password: S.mainValue }).catch(() => null);
      if (o && o.state === "open") { S.session = o.session; S.mainValue = null; return enterMain(C.TEXT.changedElsewhere); }
    }
    return showErr([C.TEXT.noSave]);
  }
  if (res.outcome === "invalid") return showErr(res.errors, !val("fuEd") ? "fuEd" : "fuGuest");
  if (res.outcome === "same") return showErr([C.TEXT.sameInUse], "fuEd");
  if (res.outcome !== "saved") return showErr([C.checkFailText(res.outcome, res.key)]);
  S.session = res.session; S.mainValue = null;
  // every role whose tools disagree is marked on its row; the first opens now
  // (round 1 m5)
  for (const [role, from] of Object.entries(res.differ)) diffFrom[role] = from;
  enterMain();
  const r = Object.keys(res.differ)[0];
  if (r) openChange(r, C.differText(r, res.differ[r]));
}
// first use: an account didn't take the typed value; ask for the one it uses
function askFirstUse(firstKey) {
  let after = null;
  const paint = (c, key) => {
    const a = C.ACCOUNTS.find((x) => x.key === key), w = C.ROLE_WORD[a.role], tool = capital(toolOf(key));
    c.step({ title: `The ${w} password in use`, html: `${msgLine}
        <p>${h(`${tool}'s ${w} account doesn't accept that ${w} password. Type the one it uses.`)}</p>
        ${field("pwTyped", `${w} password used by ${tool}`)}`,
      wire: wireShow,
      buttons: [{ label: "Cancel", kind: "tinted", run: (x) => x.close(null) },
        { label: "Check", kind: "filled", run: async (x, b) => {
          const typed = val("pwTyped");
          if (!typed) return showErr(["Type the password."], "pwTyped");
          SEEN.add(typed);
          const before = FU.overrides[key];
          FU.overrides[key] = typed;
          b.disabled = true; showBusy("Checking...");
          let res;
          try { res = await firstUseTry(); } catch (e) { res = { thrown: e }; }
          b.disabled = false;
          if (res.outcome === "refused" && res.keys.includes(key)) {
            if (before === undefined) delete FU.overrides[key]; else FU.overrides[key] = before;
            return showErr([C.TEXT.typedWrong], "pwTyped");
          }
          if (res.outcome === "refused") return paint(x, res.keys[0]);
          after = res; x.close(null);
        } }] });
  };
  flowDialog((c) => paint(c, firstKey), { onClose: () => {
    if (after) firstUseDone(after);
    else { const e = $("fuErr"); if (e) { e.textContent = ""; e.className = "pw-msg"; } }   // cancelled: no "Checking..." left (round 1 m6)
  } });
}

// ------------------------------------------------------------------ boot
function boot() {
  // inside a frame: do nothing (boot.js says so); checked here too (round 1 m5)
  let framed = true;
  try { framed = window.top !== window.self; } catch { framed = true; }
  if (window.__edFramed || framed) return;
  const why = ss.get(OUT_KEY);
  if (why) { ss.del(OUT_KEY); if (OUT_TEXT[why]) gateMsg(OUT_TEXT[why], why === "logout" ? "busy" : ""); }
  if (!C.isSetUp()) {
    // not set up yet: say so calmly and never try to sign in
    $("gateForm").hidden = true;
    $("gateLead").textContent = C.TEXT.notReady;
    gateMsg("");
  } else {
    $("gateForm").addEventListener("submit", onGate);
    if (!isTouch()) $("gpw").focus();
    gateCountdown();
  }
  $("logout").addEventListener("click", () => signOut("logout"));
  $("app").addEventListener("click", onAppClick);
  watchUse();
  window.__edReady = true;
}
boot();
