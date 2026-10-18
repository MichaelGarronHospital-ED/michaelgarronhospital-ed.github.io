// ============================================================================
//  Change the three shared passwords from the ED tools passwords page
//  (design B.5). A port of Physician Hiring's js/passwords.js, kept close so a
//  reviewer can diff them: same function names, same adapter, same rules.
//
//  One password opens several accounts (Leadership: this page's own account,
//  voting leadership@ and hiring admin@; ED: voting ed@ and hiring committee@;
//  Guest: hiring applicant@). Patient Hub statistics check the Admin password
//  against this page's own account (since 2026-10-18), so they follow it with
//  nothing to paste.
//
//  What is new here (Phase B): the current values come from the vault (the
//  encrypted copy in project mgh-ed-admin), so nobody types them. Every change
//  is recorded in the vault before and after each account, so it can be
//  finished from any device with nothing typed.
//
//  The rules this file keeps:
//   - The three are always different, and a new value is never one in use.
//   - A change goes in a FIXED order (this page's own account first, hiring
//     admin@ last of the Leadership ones), and signs each account in seconds
//     BEFORE its own change, including this page's own account (re-signed in
//     with the old value right before its update): Firebase's "recent sign-in"
//     rule (about 5 minutes) can then never stop one part way.
//   - Helpers keep their sign-in in memory only, never in the browser's storage.
//   - Running it again is always safe (converge): an account already changed
//     is only checked with the new value.
//   - A stored value refused once is not tried again in this tab by the
//     background checks until a person types the value in use; "too many
//     requests" stops every background check.
//   - A password value never reaches the console, storage, an error message,
//     or any Firestore field in clear.
//
//  `auth` is an adapter (the page builds the Firebase one; the tests a fake):
//    auth.open(account, password)   -> session  (signed in; throws on refusal)
//    auth.update(session, newValue) -> void     (throws {code} on failure)
//    auth.close(session)            -> void
//  `store` is store.js (read, write); the tests pass a fake.
// ============================================================================

import { ACCOUNTS as CONFIG_ACCOUNTS, ADMIN_FIREBASE, CONFIGS } from "./config.js?v=5";
import { makeLock, seal, openVault, openWithLocks, withoutNext } from "./vault.js?v=5";

export const ROLES = Object.freeze(["leadership", "ed", "guest"]);
export const ROLE_WORD = Object.freeze({ leadership: "Admin", ed: "ED", guest: "Guest" });
export const TOOL_OF = Object.freeze({ admin: "the ED tools passwords page", voting: "Motion Voting", hiring: "Physician Hiring" });
const TOOL_TITLE = Object.freeze({ admin: "The ED tools passwords page", voting: "Motion Voting", hiring: "Physician Hiring" });
export const PROJECT_ID = Object.freeze(Object.fromEntries(Object.entries(CONFIGS).map(([k, c]) => [k, c.projectId])));
export const MAIN_KEY = "admin:leadership";
export const ACCOUNTS = Object.freeze(CONFIG_ACCOUNTS.map((a) => Object.freeze({
  ...a, label: `${TOOL_TITLE[a.project]}, ${ROLE_WORD[a.role]} account`, ...(a.key === MAIN_KEY ? { main: true } : {}),
})));
const byKey = (k) => ACCOUNTS.find((a) => a.key === k);
// in the order they are changed
export const accountsFor = (roles) => ACCOUNTS.filter((a) => roles.includes(a.role));

// The page works only once the project and its account exist (B.2): a web
// config and the account's uid. Until then the gate says so.
// (admin and uid are for the tests; the page passes neither)
export const isSetUp = ({ admin = ADMIN_FIREBASE, uid = byKey(MAIN_KEY).uid } = {}) =>
  !!(admin && admin.apiKey && admin.apiKey !== "NOT-CREATED-YET" && uid);

// Timings for the page (B.6.2, B.6.3)
export const TIMING = Object.freeze({ idleMs: 10 * 60000, hiddenMs: 5 * 60000, showMs: 30000, copiedMs: 2000, gatePauseMs: 30000 });

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code }, extra);
const today = () => new Date().toISOString();
const clone = (x) => JSON.parse(JSON.stringify(x));
const list = (w) => (w.length > 1 ? `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}` : w[0] || "");

// ---- validation (before anything is sent) -------------------------------------
// First use and recovery: the values in use now for the given roles (ED and
// Guest; Leadership is the one that just signed in).
export function validateCurrent(roles, current) {
  const errors = [];
  for (const r of roles) if (!String(current[r] || "")) errors.push(`Type the ${ROLE_WORD[r]} password in use now.`);
  if (!errors.length) {
    const vals = roles.map((r) => String(current[r]));
    if (new Set(vals).size !== vals.length || roles.some((r) => r !== "leadership" && current[r] === current.leadership))
      errors.push("The Admin, ED and Guest passwords must all be different. Check each was typed right.");
  }
  return errors;
}

// current:   { leadership, ed, guest } (the values in use now, from the vault)
// next:      { <role>: { value, repeat } } for each role being changed
// overrides: { <account key>: value } other values some account may accept
//            now (pending.from, a typed stale value, the pending next)
export function validateNew(roles, current, next, overrides = {}) {
  const errors = [];
  if (!roles.length) errors.push("Pick a password to change.");
  for (const r of ROLES) if (!String(current[r] || "")) errors.push(`The saved ${ROLE_WORD[r]} password is missing. Reload the page.`);
  for (const r of roles) {
    const n = next[r] || {}, v = String(n.value || "");
    const w = ROLE_WORD[r];
    if (v !== String(n.repeat || "")) errors.push(`The two new ${w} passwords don't match.`);
    // 6 is Firebase's own minimum (it refuses shorter); Alvin 2026-10-18: no longer force 10
    if (v.length < 6) errors.push(`The new ${w} password needs at least 6 characters.`);
    if (v !== v.trim()) errors.push(`The new ${w} password can't start or end with a space.`);
    if (v.toLowerCase().includes("password")) errors.push(`The new ${w} password can't contain the word "password".`);
    if (v && v === current[r]) errors.push(`The new ${w} password is the same as the current one.`);
    // never a value any account accepts today: if the change stopped part way,
    // that account would let its holders in as the wrong role (review M1)
    else if (v && ROLES.some((o) => o !== r && v === String(current[o] || "")))
      errors.push(`The new ${w} password is already in use. The Admin, ED and Guest passwords must all be different, and none can be one in use now.`);
    if (v && Object.values(overrides).some((x) => x && v === x))
      errors.push(`The new ${w} password is already in use. The Admin, ED and Guest passwords must all be different, and none can be one in use now.`);
  }
  // the three in use afterwards must all differ (the sign-in pages tell the
  // roles apart only by which account accepts the password)
  const after = Object.fromEntries(ROLES.map((r) => [r, roles.includes(r) ? String((next[r] || {}).value || "") : String(current[r] || "")]));
  // (one line, not two: when a new value is already in use, that line says it all)
  if ((after.leadership && (after.leadership === after.ed || after.leadership === after.guest) || (after.ed && after.ed === after.guest))
      && !errors.some((e) => e.includes("is already in use")))
    errors.push("The Admin, ED and Guest passwords must all be different.");
  return [...new Set(errors)];
}

// The vault-aware check for one role: every value some account may accept now
// counts as in use (pending.from, the pending next, a typed stale value), and
// so does every value a person typed in this tab for any row (seen).
export function validateChange(content, role, value, repeat, from = {}, seen = []) {
  const p = (content && content.pending) || null;
  const extra = { ...((p && p.from) || {}), ...from };
  if (p && p.next) extra["pending:next"] = p.next;
  const errors = validateNew([role], content.roles, { [role]: { value, repeat } }, extra);
  if (value && new Set(seen).has(value) && !errors.some((e) => e.includes("already in use") || e.includes("same as the current")))
    errors.push(TEXT.typedEarlier);
  return errors;
}

// Which current value to try for an account: its own value if the tools
// disagree (pending.from), else the role's.
export const currentFor = (acct, current, overrides = {}) => (overrides[acct.key] ? overrides[acct.key] : current[acct.role]);

const codeOf = (e) => String((e && (e.code || e.message)) || "");
export const isRefusal = (e) => !!e && /wrong-password|invalid-credential|user-not-found|invalid-login-credentials|INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/i.test(codeOf(e));
export const isThrottle = (e) => !!e && /too-many-requests|TOO_MANY_ATTEMPTS/i.test(codeOf(e));
const isRecent = (e) => !!e && /requires-recent-login/i.test(String(e.code || ""));
export const isDisabled = (e) => !!e && /user-disabled|USER_DISABLED/i.test(codeOf(e));
export const isPasswordRule = (e) => !!e && /weak-password|password-does-not-meet-requirements|WEAK_PASSWORD|PASSWORD_DOES_NOT_MEET_REQUIREMENTS/i.test(codeOf(e));
export const isNetwork = (e) => !!e && /network|unavailable|deadline-exceeded/i.test(codeOf(e));
export const whyOf = (e) => (isThrottle(e) ? "throttled" : isRefusal(e) ? "refused" : isDisabled(e) ? "disabled" : isPasswordRule(e) ? "rules" : "error");
const refusal = (extra = {}) => fail("auth/invalid-credential", "refused", extra);

// What Check proves before a change: every account of the role, then the
// Physician Hiring account of each other role, so "all different" rests on
// values an account actually accepted (review M1; round 1 m7: a value saved
// here may be out of date). Values already refused in this tab are not tried
// again (the guard), they stop Check at once.
// skip: accounts not to prove with the current value (when finishing: those
// that may already have the new one)
export const checkAccountsFor = (roles, skip = []) => [...accountsFor(roles),
  ...ACCOUNTS.filter((a) => a.project === "hiring" && !roles.includes(a.role))].filter((a) => !skip.includes(a.key));

// Step 1, "Check first": prove every account with its current value; change
// nothing, keep nothing. Stops at the first refusal. -> { ok, results: [{ key, ok, why }] }
export async function preflight(auth, roles, current, overrides = {}, skip = []) {
  const results = [];
  for (const a of checkAccountsFor(roles, skip)) {
    let s = null;
    try { s = await auth.open(a, currentFor(a, current, overrides)); results.push({ key: a.key, label: a.label, ok: true }); }
    catch (e) {
      results.push({ key: a.key, label: a.label, ok: false, why: whyOf(e), code: e && e.code });
      return { ok: false, results };
    } finally { if (s) await auth.close(s); }
  }
  return { ok: true, results };
}

// Make one account have the new value. Safe to repeat.
//   state: "done" (already changed: only check the new value), "inProgress" (it
//   may have changed before that was recorded: new first, then old), or "todo".
export async function converge(auth, a, oldValue, newValue, state = "todo") {
  const tryOpen = async (v) => { try { return await auth.open(a, v); } catch (e) { if (isRefusal(e)) return null; throw e; } };
  if (state === "done" || state === "inProgress") {
    const s = await tryOpen(newValue);
    if (s) { await auth.close(s); return "already"; }
    // recorded as changed, but it doesn't take the new value: someone changed
    // it another way since (code "not-first-value")
    if (state === "done") { const e = new Error(`${a.label} doesn't accept the new password.`); e.code = "not-first-value"; e.account = a.key; throw e; }
  }
  // sign in seconds before the change; one retry if Firebase still asks for a
  // recent sign-in
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await tryOpen(oldValue);
    if (!s) { const e = new Error(`${a.label} didn't accept the current password.`); e.code = "refused"; e.account = a.key; throw e; }
    try { await auth.update(s, newValue); return "changed"; }
    catch (e) { if (!(isRecent(e) && attempt === 0)) throw e; }
    finally { await auth.close(s); }
  }
  return "changed";
}

// Step 3, each account in order. progress: { done: [keys], inProgress: key|null,
// unsure: [keys] } as recorded in the vault (pending), or empty; "unsure"
// accounts (the check after a change didn't confirm them) are tried with the
// new value first, like the one in progress. record(p) saves progress before
// and after each account. -> { changed: [keys], failedAt: key|null, error }
export async function applyChange(auth, roles, current, next, { overrides = {}, progress = {}, record = async () => {} } = {}) {
  const done = new Set(progress.done || []), unsure = new Set(progress.unsure || []);
  const changed = [];
  for (const a of accountsFor(roles)) {
    // unsure first: such an account is also recorded as done (round 1 L-M1)
    const state = progress.inProgress === a.key || unsure.has(a.key) ? "inProgress" : done.has(a.key) ? "done" : "todo";
    try {
      await record({ done: [...done], inProgress: a.key });
      await converge(auth, a, currentFor(a, current, overrides), next[a.role].value, state);
      done.add(a.key); changed.push(a.key);
      await record({ done: [...done], inProgress: null, settled: a.key });
    } catch (e) {
      return { changed, done: [...done], failedAt: a.key, error: e };
    }
  }
  return { changed, done: [...done], failedAt: null, error: null };
}

// Step 4: sign in to every changed account with the new value.
// -> [{ key, why }] for each account that didn't confirm it ("refused",
// "throttled", "disabled" or "error": a network problem is not a mismatch)
export async function verify(auth, roles, next) {
  const bad = [];
  for (const a of accountsFor(roles)) {
    let s = null;
    try { s = await auth.open(a, next[a.role].value); } catch (e) { bad.push({ key: a.key, why: whyOf(e), code: e && e.code }); } finally { if (s) await auth.close(s); }
  }
  return bad;
}

// "The ED password is new in Motion Voting but still old in Physician Hiring."
export function halfDoneText(roles, done) {
  const lines = [];
  for (const r of roles) {
    const accts = ACCOUNTS.filter((a) => a.role === r);
    const newIn = [...new Set(accts.filter((a) => done.includes(a.key)).map((a) => TOOL_OF[a.project]))];
    const oldIn = [...new Set(accts.filter((a) => !done.includes(a.key)).map((a) => TOOL_OF[a.project]))];
    if (newIn.length && oldIn.length) lines.push(`The ${ROLE_WORD[r]} password is new in ${list(newIn)} but still old in ${list(oldIn)}.`);
  }
  return lines;
}

// ---- the background-check guard (B.5.2, B.6.4) ----------------------------------
// Remembers, in memory only, which value each account refused, so a stored
// value is not tried again by a background check until a person types the one
// in use; and whether Firebase said "too many requests" (stops them all).
export function makeGuard() {
  const refused = new Map();   // account key -> Set of refused values (memory only)
  return {
    throttled: false,
    refusedBefore: (key, v) => !!(refused.get(key) && refused.get(key).has(v)),
    noteRefused: (key, v) => { if (!refused.has(key)) refused.set(key, new Set()); refused.get(key).add(v); },
    accepted: (key, v) => { if (refused.has(key)) refused.get(key).delete(v); },
    forget: (key) => { refused.delete(key); },
    clear() { refused.clear(); this.throttled = false; },
  };
}

// The adapter with the guard around it. skipKnown: a value this account
// already refused is refused again without asking Firebase (background checks
// and Check first); the change itself always really asks, and only records.
export function guarded(auth, guard, { skipKnown = false } = {}) {
  if (!guard) return auth;
  return {
    async open(a, pw) {
      if (skipKnown && guard.refusedBefore(a.key, pw)) throw refusal({ known: true });
      try { const inner = await auth.open(a, pw); guard.accepted(a.key, pw); return { inner, key: a.key }; }
      catch (e) {
        if (isRefusal(e)) guard.noteRefused(a.key, pw);
        if (isThrottle(e)) guard.throttled = true;
        throw e;
      }
    },
    async update(s, v) {
      try { await auth.update(s.inner, v); } catch (e) { if (isThrottle(e)) guard.throttled = true; throw e; }
      guard.accepted(s.key, v);
    },
    async close(s) { if (s) await auth.close(s.inner); },
  };
}

// ---- the open vault in this tab ---------------------------------------------------
// The value each lock object of this tab was made from (memory only), so that
// checking a lock's pending.next costs no extra PBKDF2 when this tab made it.
const MADE_FROM = new WeakMap();
const madeFrom = (lock, value) => { if (lock) MADE_FROM.set(lock, value); return lock; };

// Holds the decrypted content, the document number (gen) last seen, and the
// lock keys this tab can seal with (in memory only). Every write goes through
// write(): a transaction that stops with "changed-elsewhere" if another device
// wrote meanwhile (store.js).
export class Session {
  constructor({ store, mainValue }) {
    this.store = store;
    this.mainValue = mainValue;   // the Leadership value this tab signed in with
    this.doc = null; this.gen = 0; this.content = null; this.locks = [];
  }

  // Learn the content and which of the document's locks this tab can seal.
  // The OLD lock of a Leadership change is the one without pending.next.
  // Round 1 S-M1: a lock may hold a Leadership pending.next only if that very
  // value is the lock's own key. Anyone who knows only the OLD Leadership
  // password could otherwise plant a "change" under the OLD lock with a new
  // value they chose, and Finish would set every Leadership account to it. A
  // next that doesn't open its own lock is dropped: that content is the
  // honest "nothing changed yet" state (Go on with the new value, or Cancel).
  async adopt(doc, known) {
    const mine = []; let best = null;
    for (const l of doc.locks) {
      const k = (known || []).find((x) => x && x.salt === l.salt && x.iter === l.iter);
      if (!k) continue;
      const r = await openWithLocks({ ...doc, locks: [l] }, [k]);
      if (!r) continue;
      let content = r.content;
      const p0 = content.pending;
      if (p0 && p0.role === "leadership" && p0.next) {
        let honest;
        if (MADE_FROM.has(k)) honest = MADE_FROM.get(k) === p0.next;
        else {
          let nl = null;
          try { nl = await makeLock(String(p0.next), { salt: l.salt, iter: l.iter }); } catch { nl = null; }
          honest = !!(nl && (await openWithLocks({ ...doc, locks: [l] }, [nl])));
          if (honest) madeFrom(k, p0.next);
        }
        if (!honest) content = withoutNext(content);
      }
      const p = content.pending;
      const hide = !!(p && p.role === "leadership" && !p.next);
      const { hideNext, ...lock } = k;
      const kept = hide ? { ...lock, hideNext: true } : lock;
      if (MADE_FROM.has(k)) madeFrom(kept, MADE_FROM.get(k));
      mine.push(kept);
      if (!best || !hide) best = content;
    }
    if (!best) throw fail("locked-out", "This page can't open the saved copy any more. Sign in again.");
    this.doc = doc; this.gen = doc.gen; this.content = best; this.locks = mine;
    return this;
  }

  // the document has a lock this tab can't seal (the other one of a change)
  get missingLock() { return !!this.doc && this.locks.length < this.doc.locks.length; }

  // mutate(copy) -> the new content. opts.locks: the locks to seal with
  // (default: this tab's). opts.cancel: allowed to drop the NEW lock.
  async write(mutate, opts = {}) {
    const locks = opts.locks || this.locks;
    const p = this.content && this.content.pending;
    // a tab that opened only the OLD lock of a Leadership change must never
    // write without the NEW one (it would lose the new value); only Cancel
    if (this.missingLock && locks.length < this.doc.locks.length && !(p && p.next) && !opts.cancel)
      throw fail("needs-next", "Type the new Admin password first.");
    let made = null;
    const doc = await this.store.write(this.gen, async () => {
      made = mutate(clone(this.content));
      return { v: 1, gen: this.gen + 1, locks: await seal(made, locks, this.gen + 1) };
    });
    const { pad, ...rest } = made;
    this.doc = doc; this.gen = doc.gen; this.content = { ...rest, v: 1, gen: doc.gen }; this.locks = locks;
    return this.content;
  }

  // After "changed-elsewhere": read the latest and open it with the keys this
  // tab has (no password). Throws "locked-out" if none opens it any more.
  async reload() {
    const doc = await this.store.read();
    if (!doc) throw fail("locked-out", "The saved copy is gone. Sign in again.");
    return this.adopt(doc, this.locks);
  }

  // A Leadership change started elsewhere and this tab opened the OLD lock:
  // the new password, typed again, must open the NEW lock ("Go on").
  async unlockNext(typed) {
    const p = this.content && this.content.pending;
    if (!p || p.role !== "leadership" || p.next || !this.missingLock) throw fail("not-needed", "Nothing to unlock.");
    const mineSalts = new Set(this.locks.map((l) => l.salt));
    const other = this.doc.locks.find((l) => !mineSalts.has(l.salt));
    let lock;
    try { lock = await makeLock(String(typed || ""), { salt: other.salt, iter: other.iter }); } catch { lock = null; }
    const r = lock && (await openWithLocks({ ...this.doc, locks: [other] }, [lock]));
    if (!r || !r.content.pending || r.content.pending.next !== typed) throw fail("not-next", "That is not the new Admin password typed when the change started.");
    await this.adopt(this.doc, [...this.locks, madeFrom(lock, typed)]);
    return this;
  }

  // drop keys and values (idle, hidden, log out)
  close() { this.content = null; this.locks = []; this.mainValue = null; this.doc = null; }
}

// One read of vault/main, then one PBKDF2 per lock until one opens.
// -> { state: "open", session } | { state: "first-use", expectGen: 0 }
//  | { state: "locked", reason: "old-password" | "refused", expectGen }
export async function openSession({ store, password }) {
  const doc = await store.read();
  if (!doc) return { state: "first-use", expectGen: 0 };
  let opened;
  try { opened = await openVault(doc, password); }
  catch (e) {
    if (e && e.code === "vault-refused") return { state: "locked", reason: "refused", expectGen: Number.isInteger(doc.gen) ? doc.gen : null };
    throw e;
  }
  if (!opened) return { state: "locked", reason: "old-password", expectGen: doc.gen };
  const session = new Session({ store, mainValue: password });
  await session.adopt(doc, [madeFrom(opened.lock, password)]);
  return { state: "open", session };
}

// ---- what each account should accept now (B.6.4) -------------------------------
// -> [{ value, kind }] in the order to try. For the role of a pending change it
// is the finishing order: done with next; in progress and unsure with next,
// then old; the rest with old. With only the OLD lock open (no next), done
// accounts are not checked at all.
export function expectedFor(content, a) {
  const p = content.pending;
  if (!p || p.role !== a.role) return [{ value: content.roles[a.role], kind: "old" }];
  const old = { value: currentFor(a, content.roles, p.from || {}), kind: "old" };
  const nxt = p.next ? { value: p.next, kind: "next" } : null;
  if (p.inProgress === a.key || (p.unsure || []).includes(a.key)) return nxt ? [nxt, old] : [old];
  if ((p.done || []).includes(a.key)) return nxt ? [nxt] : [];
  return [old];
}

// The quiet check when the page opens: one account at a time, closed at once.
// -> { results: [{ key, role, ok, why, kind, finishing, skipped }],
//      stale: { <role>: [keys] }, finishing: [keys], stopped: "throttled" | null }
// A refusal for the role of a pending change goes on the Finish line
// (finishing), never into stale. onResult(r) is called after each account.
// roles: only these roles' accounts (the page checks one row at a time).
export async function quietCheck({ auth, session, guard }, { onResult = () => {}, roles = ROLES } = {}) {
  const content = session.content;
  const ad = guarded(auth, guard, { skipKnown: true });
  const out = { results: [], stale: {}, finishing: [], stopped: null };
  const note = (r) => {
    out.results.push(r);
    if (!r.ok && r.why === "refused") {
      if (r.finishing) out.finishing.push(r.key);
      else (out.stale[r.role] = out.stale[r.role] || []).push(r.key);
    }
    onResult(r);
  };
  for (const a of ACCOUNTS.filter((x) => roles.includes(x.role))) {
    const tries = expectedFor(content, a);
    if (!tries.length) continue;
    const finishing = !!(content.pending && content.pending.role === a.role);
    if (a.main) {
      // signed in to it a moment ago with mainValue: no sign-in needed
      const hit = tries.find((t) => t.value === session.mainValue);
      note({ key: a.key, role: a.role, ok: !!hit, why: hit ? null : "refused", kind: hit ? hit.kind : null, finishing });
      continue;
    }
    if (guard && guard.throttled) { out.stopped = "throttled"; break; }
    let res = null;
    for (const t of tries) {
      let s = null;
      try { s = await ad.open(a, t.value); res = { key: a.key, role: a.role, ok: true, why: null, kind: t.kind, finishing }; break; }
      catch (e) {
        res = { key: a.key, role: a.role, ok: false, why: whyOf(e), code: e && e.code, kind: null, finishing, ...(e && e.known ? { skipped: true } : {}) };
        if (!isRefusal(e)) break;
      } finally { if (s) await ad.close(s); }
    }
    note(res);
    if (res && res.why === "throttled") { out.stopped = "throttled"; break; }
  }
  return out;
}

// ---- a change, start to finish (B.5.3) ------------------------------------------
// ctx: { auth, session, guard, now }
//   blockedBy(content, role): null, or the message why Change is off
export function blockedBy(content, role) {
  const p = content && content.pending;
  if (!p) return null;
  if (p.role !== role) return `Finish or cancel the ${ROLE_WORD[p.role]} change first.`;
  return "Finish this change first.";
}

// keep only accounts of the role whose value differs from the saved one
const cleanFrom = (content, role, from) => Object.fromEntries(Object.entries(from || {})
  .filter(([k, v]) => { const a = byKey(k); return a && a.role === role && v && v !== content.roles[role]; }));

// 1. Check first: each account of the role with its current value. Nothing changes.
// known: { <account key>: value } every account value this tab already knows
// differs from the saved one, for ANY role (the rows' "not the same in every
// tool", pending.from). The other roles' hiring accounts are proven with those,
// so two roles whose hiring accounts both differ don't stop each other's
// Check (round 2 N-M1).
export async function checkFirst({ auth, session, guard }, role, from = {}, known = {}) {
  const c = session.content;
  const others = Object.fromEntries(Object.entries({ ...((c.pending && c.pending.from) || {}), ...known })
    .filter(([k, v]) => { const a = byKey(k); return a && a.role !== role && v && v !== c.roles[a.role]; }));
  return preflight(guarded(auth, guard, { skipKnown: true }), [role], c.roles, { ...others, ...cleanFrom(c, role, from) });
}

// 2. Start (one write): pending, and for Leadership the NEW lock (the OLD lock
// is marked hideNext, so it never holds the new value).
export async function startChange({ session, now = today }, role, value, from = {}) {
  const c = session.content;
  if (c.pending) throw fail("pending-other", blockedBy(c, role));
  const errs = validateChange(c, role, value, value, from);
  if (errs.length) throw fail("invalid", errs[0], { errors: errs });
  let locks = session.locks;
  if (role === "leadership") {
    if (session.locks.length !== 1) throw fail("bad-locks", "Reload the page and try again.");
    const { hideNext, ...old } = session.locks[0];
    const oldLock = { ...old, hideNext: true };
    if (MADE_FROM.has(session.locks[0])) madeFrom(oldLock, MADE_FROM.get(session.locks[0]));
    locks = [oldLock, madeFrom(await makeLock(value), value)];
  }
  const f = cleanFrom(c, role, from);
  return session.write((x) => {
    x.pending = { role, next: value, ...(Object.keys(f).length ? { from: f } : {}), startedAt: now(), done: [], inProgress: null, unsure: [] };
    return x;
  }, { locks });
}

// 3 to 5: each account in order (inProgress written first, then done), verify,
// finish. The write recording this page's own account as done drops the OLD
// lock. Used for a new change and for Finish (from the recorded progress).
// -> { ok: true } | { ok: false, stage: "change" | "verify" | "finish", failedAt, error, done, bad }
export async function runChange({ auth, session, guard, now = today, onProgress = () => {} }) {
  const p0 = session.content.pending;
  if (!p0) return { ok: true, stage: "none" };
  if (!p0.next) throw fail("needs-next", "Type the new Admin password first.");
  const role = p0.role, next = { [role]: { value: p0.next } };
  const ad = guarded(auth, guard);
  const record = async (prog) => {
    const dropOld = role === "leadership" && prog.done.includes(MAIN_KEY) && session.locks.some((l) => l.hideNext);
    await session.write((x) => {
      x.pending = { ...x.pending, done: prog.done, inProgress: prog.inProgress, unsure: (x.pending.unsure || []).filter((k) => k !== prog.settled) };
      return x;
    }, dropOld ? { locks: session.locks.filter((l) => !l.hideNext) } : {});
    if (role === "leadership" && prog.done.includes(MAIN_KEY)) session.mainValue = p0.next;
    onProgress({ done: prog.done, inProgress: prog.inProgress });
  };
  const r = await applyChange(ad, [role], session.content.roles, next, { overrides: p0.from || {}, progress: p0, record });
  if (r.failedAt) return { ok: false, stage: "change", ...r };
  onProgress({ done: r.done, inProgress: null, verifying: true });
  const bad = await verify(ad, [role], next);
  if (bad.length) {
    // not confirmed is not the same as wrong: Finish tries those with the new
    // value first. They stay in done (they may well have it: no Cancel now)
    // and are listed in unsure beside it (round 1 L-M1).
    const keys = bad.map((b) => b.key);
    const doneNow = r.done;
    let error = null;
    try {
      await session.write((x) => { x.pending = { ...x.pending, done: doneNow, inProgress: null, unsure: keys }; return x; });
    } catch (e) { error = e; }
    const why = bad.find((b) => b.why !== "refused") || bad[0];
    return { ok: false, stage: "verify", failedAt: keys[0], done: doneNow, bad,
      error: error || Object.assign(new Error("verify"), { code: why.why === "refused" ? "mismatch" : why.code || why.why }) };
  }
  try {
    await session.write((x) => { x.roles[role] = p0.next; x.changedAt = { ...(x.changedAt || {}), [role]: now() }; x.pending = null; return x; });
  } catch (e) { return { ok: false, stage: "finish", failedAt: null, done: r.done, error: e }; }
  if (role === "leadership") session.mainValue = p0.next;
  return { ok: true };
}

// Change now: Check first, Start, then run. -> { ok, stage, ... }; a refusal
// at Check is { ok: false, stage: "check", results } (the stale flow).
export async function changePassword(ctx, role, value, { from = {}, known = {} } = {}) {
  const pre = await checkFirst(ctx, role, from, known);
  if (!pre.ok) {
    // a refusal may only mean another device changed a password meanwhile:
    // one read of the vault tells (then it is "changed elsewhere", not stale)
    let live = null;
    try { live = await ctx.session.store.read(); } catch { live = null; }
    if (live && live.gen !== ctx.session.gen) throw fail("changed-elsewhere", TEXT.changedElsewhere);
    return { ok: false, stage: "check", results: pre.results };
  }
  await startChange(ctx, role, value, from);
  return runChange(ctx);
}

// Finish the change: pending.next from the vault, nothing typed (except the
// one Leadership case: unlockNext first).
export async function finishChange(ctx) {
  const p = ctx.session.content.pending;
  if (!p) return { ok: true, stage: "none" };
  if (!p.next) throw fail("needs-next", "Type the new Admin password first.");
  return runChange(ctx);
}

// Cancel only while nothing was touched: done empty and nothing in progress.
// One write drops pending (and for Leadership the NEW lock).
export function canCancel(session) {
  const p = session.content && session.content.pending;
  if (!p || (p.done || []).length || p.inProgress || (p.unsure || []).length) return false;
  // Leadership: only a tab holding the OLD lock can keep it (a tab that opened
  // only the NEW one can't seal the OLD one again)
  if (p.role === "leadership") return session.locks.some((l) => l.hideNext);
  return true;
}
export async function cancelChange({ session }) {
  if (!canCancel(session)) throw fail("cannot-cancel", "This change can't be cancelled any more, because an account already has the new password. Press Finish the change.");
  const p = session.content.pending;
  let locks = session.locks;
  if (p.role === "leadership") {
    const old = session.locks.find((l) => l.hideNext) || session.locks[0];
    const { hideNext, ...plainLock } = old;
    locks = [plainLock];
  }
  return session.write((x) => { x.pending = null; return x; }, { locks, cancel: true });
}

// Part way, an account accepts neither the saved value nor the new one: a
// person types the one in use; it goes into pending.from (one write).
// -> { outcome: "refused" | "saved" | "already" | "throttled" | "error" }
export async function fixAccount({ auth, session, guard }, key, typed) {
  const p = session.content.pending, a = byKey(key);
  if (!p || !a || a.role !== p.role || a.main) throw fail("not-needed", "Nothing to fix.");
  if (guard) guard.forget(key);
  const ad = guarded(auth, guard);
  let s = null;
  try { s = await ad.open(a, typed); }
  catch (e) { return { outcome: isRefusal(e) ? "refused" : whyOf(e) === "throttled" ? "throttled" : "error", error: e }; }
  finally { if (s) await ad.close(s); }
  if (typed === p.next) return { outcome: "already" };
  await session.write((x) => { x.pending = { ...x.pending, from: { ...(x.pending.from || {}), [key]: typed } }; return x; });
  return { outcome: "saved" };
}

// ---- the stale flow (B.5.5) ------------------------------------------------------
// A person typed the value in use for one account of a role (never the role of
// a pending change). status: { <key>: "ok" | "refused" } from the quiet check.
// known: { <key>: value } accounts already found. -> {
//   outcome: "refused"     (that didn't work either; nothing saved)
//          | "need-more"   (keys: other accounts of the role still unknown)
//          | "ok"          (it is the saved value after all)
//          | "save"        (every account takes value, unlike the other roles: saveStale)
//          | "same-as-other" (otherRole: not saved; open Change with from)
//          | "differ"      (the accounts differ: open Change with from)
//          | "throttled" | "error",
//   known, from, value }
export async function checkTyped({ auth, session, guard }, role, key, typed, { status = {}, known = {} } = {}) {
  const c = session.content, a = byKey(key);
  if (!a || a.role !== role) throw fail("not-needed", "Nothing to check.");
  // never during a pending change: not for its role (that row offers Finish),
  // and not for another (round 1 m4: the result could not be saved anyway)
  if (c.pending && c.pending.role === role) throw fail("pending-role", "Finish this change first.");
  if (c.pending) throw fail("pending-other", blockedBy(c, role));
  const k = { ...known };
  const ad = guarded(auth, guard);
  const tryOne = async (acct, v) => {
    if (acct.main) return v === session.mainValue ? "ok" : "refused";
    let s = null;
    try { s = await ad.open(acct, v); return "ok"; }
    catch (e) { return isRefusal(e) ? "refused" : whyOf(e) === "throttled" ? "throttled" : "error"; }
    finally { if (s) await ad.close(s); }
  };
  if (guard) guard.forget(key);      // a person typed it
  const first = await tryOne(a, typed);
  if (first !== "ok") return { outcome: first, known: k };
  k[key] = typed;
  const unknown = [];
  for (const b of accountsFor([role])) {
    if (b.key in k) continue;
    if (b.main) { k[b.key] = session.mainValue; continue; }
    if (status[b.key] === "ok") { k[b.key] = c.roles[role]; continue; }
    // refused (or not checked yet): try the typed value once
    const t = await tryOne(b, typed);
    if (t === "ok") { k[b.key] = typed; continue; }
    if (t !== "refused") return { outcome: t, known: k };
    if (status[b.key] !== "refused") {
      const t2 = await tryOne(b, c.roles[role]);
      if (t2 === "ok") { k[b.key] = c.roles[role]; continue; }
      if (t2 !== "refused") return { outcome: t2, known: k };
    }
    unknown.push(b.key);
  }
  if (unknown.length) return { outcome: "need-more", keys: unknown, known: k };
  return sortOut(c, role, k);
}

function sortOut(c, role, k) {
  const keys = accountsFor([role]).map((b) => b.key);
  const values = [...new Set(keys.map((x) => k[x]))];
  const from = Object.fromEntries(keys.filter((x) => k[x] !== c.roles[role]).map((x) => [x, k[x]]));
  if (values.length > 1) return { outcome: "differ", known: k, from };
  const v = values[0];
  if (v === c.roles[role]) return { outcome: "ok", known: k };
  const otherRole = ROLES.find((o) => o !== role && c.roles[o] === v);
  if (otherRole) return { outcome: "same-as-other", otherRole, known: k, from };
  return { outcome: "save", value: v, known: k };
}

// After a reload (another device wrote): the roles whose remembered "the
// tools disagree" values may be out of date, because that role's saved value
// or date moved, or a change of it started, finished or was cancelled
// elsewhere (round 3). The page forgets those values; the quiet check finds
// the truth again.
export function movedRoles(before, after) {
  const pRole = (c) => (c && c.pending ? c.pending.role : null);
  const at = (c, r) => ((c && c.changedAt) || {})[r] ?? null;
  return ROLES.filter((r) => !before || !after
    || before.roles[r] !== after.roles[r] || at(before, r) !== at(after, r)
    || (pRole(before) === r) !== (pRole(after) === r) || pRole(after) === r);
}

// "save": the role's saved value becomes the one every account takes (one
// write). Its "changed" date is not known, so it is cleared.
export async function saveStale({ session }, role, value) {
  const c = session.content;
  if (c.pending) throw fail("pending-other", blockedBy(c, role));
  if (ROLES.some((o) => o !== role && c.roles[o] === value)) throw fail("invalid", sameAsText(role, ROLES.find((o) => o !== role && c.roles[o] === value)));
  return session.write((x) => { x.roles[role] = value; x.changedAt = { ...(x.changedAt || {}), [role]: null }; return x; });
}

// ---- first use and recovery (B.5.6) ------------------------------------------------
// No vault (expectGen 0), or no lock opens with the signed-in password
// (expectGen = the document's gen; the new copy replaces it).
// typed: { ed, guest } in use now. overrides: { <key>: value } typed for one
// account in the stale dialog. proven: { <key>: value } accounts already
// proven (not tried again). -> {
//   outcome: "refused" (keys) | "same" (roles) | "saved" (session, differ)
//          | "throttled" | "disabled" | "error" (key), proven }
// differ: { <role>: from } for a role whose accounts take different values:
// open its Change with that from straight away (the change's start write
// records it; if cancelled, the quiet check finds it again).
export async function firstUse({ auth, store, guard, mainValue, expectGen = 0 }, typed, { overrides = {}, proven = {} } = {}) {
  const current = { leadership: mainValue, ed: typed.ed, guest: typed.guest };
  const errs = validateCurrent(ROLES, current);
  if (errs.length) return { outcome: "invalid", errors: errs, proven };
  const ad = guarded(auth, guard);
  const pr = { ...proven }, refused = [];
  for (const a of ACCOUNTS) {
    if (a.key in pr) continue;
    if (a.main) { pr[a.key] = mainValue; continue; }
    const v = overrides[a.key] || current[a.role];
    if (guard && overrides[a.key]) guard.forget(a.key);
    let s = null;
    try { s = await ad.open(a, v); pr[a.key] = v; }
    catch (e) {
      const why = whyOf(e);
      if (why === "refused") { refused.push(a.key); continue; }
      return { outcome: why === "rules" ? "error" : why, key: a.key, proven: pr };
    } finally { if (s) await ad.close(s); }
  }
  if (refused.length) return { outcome: "refused", keys: refused, proven: pr };
  const roles = {}, differ = {};
  for (const r of ROLES) {
    const keys = accountsFor([r]).map((a) => a.key);
    const vals = keys.map((k) => pr[k]);
    // Leadership is the value that signed in; else the typed one if an account
    // takes it, else the first account's
    roles[r] = r === "leadership" ? mainValue : vals.includes(current[r]) ? current[r] : vals[0];
    const from = Object.fromEntries(keys.filter((k) => pr[k] !== roles[r]).map((k) => [k, pr[k]]));
    if (Object.keys(from).length) differ[r] = from;
  }
  if (new Set(Object.values(roles)).size !== 3) return { outcome: "same", roles: ROLES.filter((r) => ROLES.some((o) => o !== r && roles[o] === roles[r])), proven: pr };
  const lock = await makeLock(mainValue);
  const content = { roles, pending: null, changedAt: { leadership: null, ed: null, guest: null } };
  const gen = (expectGen || 0) + 1;
  const doc = await store.write(expectGen || 0, async () => ({ v: 1, gen, locks: await seal(content, [lock], gen) }));
  const session = new Session({ store, mainValue });
  await session.adopt(doc, [madeFrom(lock, mainValue)]);
  return { outcome: "saved", session, differ, proven: pr };
}

// ---- the Firebase adapter -----------------------------------------------------------
// Helpers are separate Firebase apps whose sign-in lives in MEMORY only
// (initializeAuth with inMemoryPersistence, never getAuth), closed and deleted
// at once. Only the pinned account counts: a sign-in that lands on another uid
// is a refusal. The page's own Leadership account is checked by
// re-authenticating the signed-in user (known by uid, never by email).
//   sdk: { initializeApp, deleteApp, initializeAuth, inMemoryPersistence,
//          signInWithEmailAndPassword, updatePassword, signOut,
//          reauthenticateWithCredential, EmailAuthProvider }
export function makeFirebaseAdapter(sdk, { mainAuth, configs = CONFIGS, connect = null }) {
  let n = 0;
  return {
    async open(a, password) {
      if (!a.uid) throw fail("not-set-up", "This page is not ready yet.");
      if (a.main) {
        const user = mainAuth && mainAuth.currentUser;
        if (!user || user.uid !== a.uid) throw fail("signed-out", "You were signed out.");
        await sdk.reauthenticateWithCredential(user, sdk.EmailAuthProvider.credential(user.email || a.email, password));
        return { main: true, user };
      }
      const app = sdk.initializeApp(configs[a.project], `pw-${Date.now().toString(36)}-${n++}`);
      const auth = sdk.initializeAuth(app, { persistence: sdk.inMemoryPersistence });
      if (connect) connect(auth, a.project);
      try {
        const cred = await sdk.signInWithEmailAndPassword(auth, a.email, password);
        if (!cred || !cred.user || cred.user.uid !== a.uid) throw refusal();
        return { app, auth, user: cred.user };
      } catch (e) { try { await sdk.signOut(auth); } catch { /* none */ } try { await sdk.deleteApp(app); } catch { /* gone */ } throw e; }
    },
    async update(s, value) { await sdk.updatePassword(s.user, value); },
    async close(s) {
      if (!s || s.main) return;
      try { await sdk.signOut(s.auth); } catch { /* already */ }
      try { await sdk.deleteApp(s.app); } catch { /* already */ }
    },
  };
}

// ---- the gate (B.6.2) -----------------------------------------------------------------
// Sign in this page's own app (initializeAuth with inMemoryPersistence, set up
// by the page) as the Leadership account; only the pinned uid counts.
// (account and ready are for the tests; the page passes neither)
export async function signInGate(sdk, mainAuth, password, { account = byKey(MAIN_KEY), ready = isSetUp } = {}) {
  const a = account;
  if (!a.uid || !ready()) throw fail("not-set-up", "This page is not ready yet.");
  const cred = await sdk.signInWithEmailAndPassword(mainAuth, a.email, password);
  if (!cred || !cred.user || cred.user.uid !== a.uid) {
    try { await sdk.signOut(mainAuth); } catch { /* local anyway */ }
    throw refusal();
  }
  return cred.user;
}

export function signInError(e) {
  const c = (e && e.code) || "";
  if (c === "not-set-up") return "This page is not ready yet. Ask the person who looks after the ED tools to finish setting it up.";
  if (c === "app/sdk-unreachable")
    return "Couldn't load the sign-in service. A hospital network, VPN or content blocker may be blocking www.gstatic.com. Try mobile data.";
  if (c.includes("too-many-requests")) return TEXT.throttled;   // one wording everywhere
  if (c.includes("network")) return "Network problem. Check your connection and try again.";
  if (c.includes("user-disabled")) return "The Admin account is switched off. The department account can switch it back on in the Firebase console.";
  if (isRefusal(e)) return "Incorrect password.";
  return "Couldn't sign in. Please try again.";
}

// 3 wrong passwords on this device, then a 30-second wait. ls: { get, set, del }
// (the page's guarded localStorage). Only a count and a time are kept.
export const GATE_KEY = "ed_pw_gate";
function gateState(ls) { try { return JSON.parse(ls.get(GATE_KEY) || "{}") || {}; } catch { return {}; } }
export const gatePausedFor = (ls, now = Date.now()) => Math.max(0, (gateState(ls).until || 0) - now);
export function gateWrong(ls, now = Date.now()) {
  const g = gateState(ls);
  g.n = (g.n || 0) + 1;
  if (g.n >= 3) { g.n = 0; g.until = now + TIMING.gatePauseMs; }
  ls.set(GATE_KEY, JSON.stringify(g));
  return !!g.until && g.until > now;
}
export const gateRight = (ls) => ls.del(GATE_KEY);
export const gateWrongText = (paused) => "Incorrect password. This page needs the Admin password." + (paused ? " To protect the accounts, wait 30 seconds before trying again." : "");

// ---- words for the page (all plain, no value in any of them) ---------------------------
const shortDay = (iso) => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""; };
export const longDay = (iso) => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""; };
const toolTitle = (a) => TOOL_TITLE[a.project];

export const TEXT = Object.freeze({
  intro: "Change a password here and it changes in every tool.",
  gateTitle: "ED tools passwords",
  opening: "Opening...",
  firstUse: "First time here. Type the ED and Guest passwords in use now. This page checks them with every tool, then keeps an encrypted copy so anyone with the Admin password can see them here.",
  recovery: "The saved copy was made with an older Admin password. Type the ED and Guest passwords in use now to make a new copy.",
  refusedDoc: "The saved copy can't be opened. Type the ED and Guest passwords in use now to make a new copy.",
  changedElsewhere: "This was just changed on another device. Here is the latest.",
  signedOut: "You were signed out, probably because a password changed.",
  hint: "At least 6 characters. Three or four words work well. Not one in use now.",
  keepOpen: "Keep this page open until it says Done.",
  tellPeople: "Tell people in person or by phone. Never email a password.",
  typedWrong: "That didn't work either. Check it was typed right.",
  notNext: "That is not the new Admin password typed when the change started.",
  throttled: "Firebase has paused sign-ins from this device for about 15 minutes. Wait, then try once.",
  frame: "Open this page on its own.",
  typedEarlier: "You typed this earlier on this page. Choose a different new password.",
  notReady: "This page is not ready yet. Ask the person who looks after the ED tools to finish setting it up.",
  idleOut: "You were signed out because the page was not used for 10 minutes. Sign in again to go on.",
  hiddenOut: "You were signed out because the page was in the background for 5 minutes. Sign in again to go on.",
  loggedOut: "You are signed out.",
  sameInUse: "Two of the passwords you typed are the same. The Admin, ED and Guest passwords must all be different. Check each was typed right. If two tools really use the same one, ask the person who looks after the ED tools.",
  brokenCopy: "The saved copy can't be opened or replaced from this page. Ask the person who looks after the ED tools.",
  noConnection: "Couldn't reach the sign-in service. Check the connection and try again.",
  noSave: "Couldn't save. Check the connection and try again.",
  savedStale: "Saved. This page now has the password every tool uses.",
  sameAsSaved: "That is the password saved here, so nothing needs to change.",
  goOn: "An Admin change was started on another device and nothing has changed yet. To go on, type the new Admin password again. Or cancel the change.",
  cancelAsk: "Nothing has changed in any tool yet. Cancel this change?",
});

export const roleTools = (r) => { const t = [...new Set(accountsFor([r]).filter((a) => !a.main).map((a) => TOOL_OF[a.project]))]; if (r === "leadership") t.push("the Patient Hub statistics page"); return t; };

// "Motion Voting's ED account doesn't accept the saved ED password. ..."
export function staleText(key) {
  const a = byKey(key), w = ROLE_WORD[a.role];
  return `${toolTitle(a)}'s ${w} account doesn't accept the saved ${w} password. Someone may have changed it another way.`;
}
export const staleRowText = (role) => `Not the same in every tool. Set a new ${ROLE_WORD[role]} password.`;
export function sameAsText(role, other) {
  const both = [...new Set(ACCOUNTS.filter((a) => !a.main && (a.role === role || a.role === other)).map((a) => a.project))]
    .filter((p) => ACCOUNTS.some((a) => a.project === p && a.role === role) && ACCOUNTS.some((a) => a.project === p && a.role === other));
  return `That is the same as the ${ROLE_WORD[other]} password, so ${list(both.map((p) => TOOL_OF[p]))} can't tell them apart. Set a new ${ROLE_WORD[role]} password now.`;
}
export function differText(role, from) {
  const tools = [...new Set(accountsFor([role]).map((a) => TOOL_OF[a.project]))];
  const t = list(tools.map((x, i) => (i === 0 ? x.charAt(0).toUpperCase() + x.slice(1) : x)));
  return `${t} have different ${ROLE_WORD[role]} passwords. Set one new ${ROLE_WORD[role]} password for ${tools.length > 2 ? "all of them" : "both"} now.`;
}
// the row's line while a change is pending
export function pendingText(content) {
  const p = content && content.pending;
  if (!p) return "";
  const w = ROLE_WORD[p.role], d = shortDay(p.startedAt);
  if (p.role === "leadership" && !p.next) return "An Admin change was started; nothing has changed yet.";
  return `A change of the ${w} password didn't finish${d ? ` (started ${d})` : ""}.`;
}
// a named account and the fix, once something changed (B.5.4)
export function failureText(error, key) {
  const a = byKey(key), code = String((error && error.code) || "");
  const who = a ? `${toolTitle(a)}'s ${ROLE_WORD[a.role]} account` : "An account";
  if (code === "changed-elsewhere") return TEXT.changedElsewhere;
  if (code === "signed-out" || code === "locked-out") return TEXT.signedOut;
  if (isDisabled(error)) return `${who} is switched off. Switch it on in the Firebase console (project ${PROJECT_ID[a ? a.project : "admin"]}, Authentication, Users), then press Finish.`;
  if (isPasswordRule(error)) return `${who} refused the new password because of its own password rules. Ask the person who looks after the ED tools.`;
  if (isThrottle(error)) return TEXT.throttled;
  if (code === "refused") return `${who} doesn't accept the saved password or the new one. Someone may have changed it another way. Type the one in use.`;
  if (code === "not-first-value") return `${who} doesn't accept the new password any more. Someone may have changed it another way. Ask the person who looks after the ED tools.`;
  if (code === "mismatch") return `${who} didn't take the new password. Press Finish to try again.`;
  if (isNetwork(error)) return "The connection dropped. Press Finish to go on.";
  return "Something went wrong. Press Finish to try again.";
}
// An account of the pending role takes neither value (B.6.4, the Finish line).
// canType: the page can offer a field for the one in use (it can't before Go on).
export function neitherText(key, canType) {
  const t = failureText({ code: "refused" }, key);
  return canType ? t : t.replace(/ Type the one in use\.$/, " Press Go on first.");
}
// "Done": the copy-ready message (never the password) and where it works
export function doneText(role) {
  const w = ROLE_WORD[role];
  return {
    works: `The new ${w} password works in ${list(roleTools(role))}.`,
    note: `The ${w} password for the ED tools changed today. Ask ED leadership for the new one.`,
    tell: TEXT.tellPeople,
  };
}
// warnings in the Change dialog (from hiring)
export function changeWarnings(role) {
  const warn = [];
  if (role === "leadership" || role === "ed") warn.push("Everyone signed in with the old password will be asked for the new one within about an hour, including phones signed in to Motion Voting. Don't do this on a voting day.");
  if (role === "guest") warn.push("Applicants who have the old Guest password won't be able to sign in. Tell them the new one in person or by phone.");
  if (role === "leadership") warn.push("Patient Hub statistics follow this password automatically.");
  return warn;
}
// Check first (or first use) stopped before anything changed: why, in words.
// why: "refused" | "throttled" | "disabled" | "error"
export function checkFailText(why, key) {
  const a = byKey(key);
  const who = a ? `${toolTitle(a)}'s ${ROLE_WORD[a.role]} account` : "An account";
  if (why === "throttled") return TEXT.throttled;
  if (why === "disabled") return `${who} is switched off, so nothing was changed. Switch it on in the Firebase console (project ${PROJECT_ID[a ? a.project : "admin"]}, Authentication, Users), then try again.`;
  if (why === "refused" && a) return staleText(key);
  return "Couldn't reach the sign-in service, so nothing was changed. Check the connection and try again.";
}
