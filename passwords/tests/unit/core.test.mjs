// core.js (design B.5, B.6.4, B.8.1). Every hiring tests/passwords.test.mjs
// case, adapted, plus the vault-based flows. A fake auth enforces Firebase's
// "recent sign-in" rule on a fake clock, including on this page's own account
// (the Auth emulator does not), so a 6-minute pause before the page's own
// change is pinned here. Every value is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLES, ACCOUNTS, MAIN_KEY, accountsFor, validateNew, validateCurrent, validateChange, preflight, applyChange, converge, verify,
  halfDoneText, makeFirebaseAdapter, makeGuard, guarded, openSession, firstUse, changePassword, startChange, runChange, finishChange,
  canCancel, cancelChange, quietCheck, checkTyped, saveStale, fixAccount, blockedBy, expectedFor, signInGate, signInError,
  gateWrong, gatePausedFor, gateRight, failureText, staleText, sameAsText, differText, pendingText, doneText, isSetUp, TEXT,
} from "../../core.js";
import { makeStore } from "../../store.js";
import { CUR, NEXT, all, fakeAuth, memFirestore } from "./fakes.mjs";

const ORDER = {
  leadership: ["admin:leadership", "voting:leadership", "hiring:admin"],
  ed: ["voting:ed", "hiring:committee"],
  guest: ["hiring:applicant"],
};
const NEXTV = Object.fromEntries(ROLES.map((r) => [r, { value: NEXT[r], repeat: NEXT[r] }]));
let tick = 0;
const now = () => new Date(Date.UTC(2026, 9, 17, 12, 0, tick++)).toISOString();

// a vault made by first use with CUR, and this tab's session
async function seeded({ passwords = all(), clock = { now: 0 }, ...opts } = {}) {
  const mem = memFirestore();
  const store = makeStore(mem.fs, mem.db);
  const auth = fakeAuth({ passwords, clock, ...opts });
  const r = await firstUse({ auth, store, mainValue: CUR.leadership }, { ed: CUR.ed, guest: CUR.guest });
  assert.equal(r.outcome, "saved");
  return { mem, store, auth, passwords, clock, session: r.session, guard: makeGuard() };
}
// another device: signs in with pw and opens the vault
async function device(store, auth, pw) {
  const o = await openSession({ store, password: pw });
  assert.equal(o.state, "open", `could not open with the ${pw === CUR.leadership ? "old" : "new"} Leadership value`);
  return { auth, session: o.session, guard: makeGuard(), now };
}
const ctxOf = (s) => ({ auth: s.auth, session: s.session, guard: s.guard, now });

// ---------------------------------------------------------------- validation
test("validation (hiring's rules, one role at a time)", () => {
  assert.deepEqual(validateNew(["ed"], CUR, { ed: NEXTV.ed }), []);
  assert.ok(validateNew([], CUR, {}).includes("Pick a password to change."));
  assert.ok(validateNew(["ed"], CUR, { ed: { value: NEXT.ed, repeat: "nope" } })[0].includes("don't match"));
  assert.ok(validateNew(["ed"], CUR, { ed: { value: "short", repeat: "short" } }).some((e) => e.includes("at least 10")));
  assert.ok(validateNew(["ed"], CUR, { ed: { value: " leading-space", repeat: " leading-space" } }).some((e) => e.includes("space")));
  assert.ok(validateNew(["ed"], CUR, { ed: { value: "MyPassword12", repeat: "MyPassword12" } }).some((e) => e.includes('"password"')));
  assert.ok(validateNew(["ed"], CUR, { ed: { value: CUR.ed, repeat: CUR.ed } }).some((e) => e.includes("same as the current")));
  // a value in use now: ONE line that says both things
  const inUse = validateNew(["ed"], CUR, { ed: { value: CUR.guest, repeat: CUR.guest } });
  assert.deepEqual(inUse, ["The new ED password is already in use. The Leadership, ED and Guest passwords must all be different, and none can be one in use now."]);
  assert.ok(validateNew(["ed", "guest"], CUR, { ed: NEXTV.ed, guest: { value: NEXT.ed, repeat: NEXT.ed } }).includes("The Leadership, ED and Guest passwords must all be different."));
  assert.ok(validateNew(["ed"], { ...CUR, guest: "" }, { ed: NEXTV.ed }).some((e) => e.includes("saved Guest password is missing")));
});

test("a new value may not be any password in use now, a pending.from value or the pending next", () => {
  assert.ok(validateNew(["ed"], CUR, { ed: { value: CUR.leadership, repeat: CUR.leadership } }).some((e) => e.includes("is already in use")));
  assert.ok(validateNew(["ed"], CUR, { ed: NEXTV.ed }, { "voting:leadership": NEXT.ed }).some((e) => e.includes("is already in use")));
  assert.deepEqual(validateNew(["ed"], CUR, { ed: NEXTV.ed }, { "voting:ed": "invented-other-voting-ed" }), []);
  const content = { roles: CUR, pending: { role: "guest", next: "invented-pending-next-7", from: { "hiring:applicant": "invented-from-8" } } };
  assert.ok(validateChange(content, "ed", "invented-pending-next-7", "invented-pending-next-7")[0].includes("already in use"));
  assert.ok(validateChange(content, "ed", "invented-from-8", "invented-from-8")[0].includes("already in use"));
  assert.ok(validateChange({ roles: CUR, pending: null }, "ed", "invented-typed-9", "invented-typed-9", { "voting:ed": "invented-typed-9" })[0].includes("already in use"));
  assert.deepEqual(validateChange({ roles: CUR, pending: null }, "ed", NEXT.ed, NEXT.ed), []);
});

test("first use needs ED and Guest, all three different", () => {
  assert.deepEqual(validateCurrent(ROLES, CUR), []);
  assert.deepEqual(validateCurrent(ROLES, { ...CUR, guest: "" }), ["Type the Guest password in use now."]);
  assert.equal(validateCurrent(ROLES, { ...CUR, guest: CUR.ed }).length, 1);
  assert.equal(validateCurrent(ROLES, { ...CUR, ed: CUR.leadership }).length, 1);
});

// ---------------------------------------------------------------- order and timing
test("the accounts, in the order of B.5.1, page's own account first", () => {
  assert.deepEqual(ACCOUNTS.map((a) => a.key), [...ORDER.leadership, ...ORDER.ed, ...ORDER.guest]);
  for (const r of ROLES) assert.deepEqual(accountsFor([r]).map((a) => a.key), ORDER[r]);
  assert.equal(ACCOUNTS.filter((a) => a.main).map((a) => a.key).join(), MAIN_KEY);
  for (const a of ACCOUNTS) assert.match(a.email, /\.invalid$/);
});

test("Check stops at the first refusal and changes nothing", async () => {
  const passwords = all();
  const auth = fakeAuth({ passwords, refuse: new Set(["hiring:committee"]) });
  const r = await preflight(auth, ["ed"], CUR);
  assert.equal(r.ok, false);
  assert.deepEqual(r.results.map((x) => [x.key, x.ok]), [["voting:ed", true], ["hiring:committee", false]]);
  assert.ok(!auth.log.some((l) => l.startsWith("update")));
});

test("each role in its order, each account signed in right before its own change; a 6-minute pause is fine, even for the page's own account", async () => {
  const s = await seeded();
  for (const role of ["guest", "ed", "leadership"]) {
    s.clock.now += 6 * 60000;            // someone read the warnings slowly; the gate sign-in is old
    s.auth.log.length = 0;
    const r = await changePassword(ctxOf(s), role, NEXT[role]);
    assert.equal(r.ok, true, `${role}: ${r.error && r.error.message}`);
    const updates = s.auth.log.filter((l) => l.startsWith("update")).map((l) => l.split(" ")[1]);
    assert.deepEqual(updates, ORDER[role]);
    for (const k of updates) {
      const i = s.auth.log.indexOf(`update ${k}`);
      assert.equal(s.auth.log[i - 1], `open ${k}`, `${k} was not signed in right before its change`);
    }
    for (const k of ORDER[role]) assert.equal(s.passwords[k], NEXT[role]);
    assert.equal(s.session.content.roles[role], NEXT[role]);
    assert.equal(s.session.content.pending, null);
  }
  assert.equal(s.session.mainValue, NEXT.leadership);
});

test("the fake really enforces the recent-login rule on the page's own account", async () => {
  const clock = { now: 0 };
  const auth = fakeAuth({ passwords: all(), clock });
  clock.now += 6 * 60000;
  await assert.rejects(() => auth.update({ key: MAIN_KEY, main: true }, NEXT.leadership), (e) => e.code === "auth/requires-recent-login");
  const s = await auth.open(ACCOUNTS[0], CUR.leadership);
  await auth.update(s, NEXT.leadership);
});

test("a requires-recent-login answer is retried once after signing in again", async () => {
  let first = true;
  const passwords = all();
  const auth = { async open(a, pw) { if (passwords[a.key] !== pw) throw Object.assign(new Error(), { code: "auth/invalid-credential" }); return { key: a.key }; },
    async update(s, v) { if (first) { first = false; throw Object.assign(new Error(), { code: "auth/requires-recent-login" }); } passwords[s.key] = v; }, async close() {} };
  const a = ACCOUNTS.find((x) => x.key === "voting:ed");
  assert.equal(await converge(auth, a, CUR.ed, NEXT.ed), "changed");
  assert.equal(passwords["voting:ed"], NEXT.ed);
  // the page's own account too
  first = true;
  assert.equal(await converge(auth, ACCOUNTS[0], CUR.leadership, NEXT.leadership), "changed");
  assert.equal(passwords[MAIN_KEY], NEXT.leadership);
});

// ---------------------------------------------------------------- half done, converge, finish
test("a change that fails half way is reported plainly and finished on another device with nothing typed", async () => {
  const s = await seeded({ failUpdateOn: "hiring:committee" });
  const r = await changePassword(ctxOf(s), "ed", NEXT.ed);
  assert.equal(r.ok, false);
  assert.equal(r.failedAt, "hiring:committee");
  assert.deepEqual(r.done, ["voting:ed"]);
  assert.deepEqual(halfDoneText(["ed"], r.done), ["The ED password is new in Motion Voting but still old in Physician Hiring."]);
  assert.equal(failureText(r.error, r.failedAt), "The connection dropped. Press Finish to go on.");
  // the page was closed; another device opens the vault and finishes
  const d = await device(s.store, s.auth, CUR.leadership);
  assert.equal(pendingText(d.session.content), "A change of the ED password didn't finish (started Oct 17).");
  assert.equal(blockedBy(d.session.content, "guest"), "Finish or cancel the ED change first.");
  const f = await finishChange(d);
  assert.equal(f.ok, true, f.error && f.error.message);
  assert.equal(s.passwords["hiring:committee"], NEXT.ed);
  assert.equal(s.passwords["voting:ed"], NEXT.ed);
  assert.equal(d.session.content.roles.ed, NEXT.ed);
  assert.equal(d.session.content.pending, null);
});

test("writes per change: ED 6, Guest 4, Leadership 8 (reads 1 each)", async () => {
  const s = await seeded();
  for (const [role, n] of [["ed", 6], ["guest", 4], ["leadership", 8]]) {
    const before = s.mem.writes;
    assert.equal((await changePassword(ctxOf(s), role, NEXT[role])).ok, true);
    assert.equal(s.mem.writes - before, n, role);
  }
});

test("converge from every half state of every role, the account in progress changed or not, finished on a fresh device", async () => {
  for (const role of ROLES) {
    const order = ORDER[role];
    for (let k = 0; k < order.length; k++) {
      for (const changed of [false, true]) {
        const s = await seeded(changed ? { loseAnswerOn: order[k] } : { failUpdateOn: order[k] });
        const r = await changePassword(ctxOf(s), role, NEXT[role]);
        assert.equal(r.ok, false);
        assert.equal(r.failedAt, order[k]);
        // the gate: the page's own account takes whichever value it has now
        const gatePw = s.passwords[MAIN_KEY];
        const d = await device(s.store, s.auth, gatePw);
        if (!d.session.content.pending.next) await d.session.unlockNext(NEXT.leadership);
        const f = await finishChange(d);
        const at = `${role} k=${k} changed=${changed}`;
        assert.equal(f.ok, true, `${at}: ${f.error && f.error.message}`);
        for (const key of order) assert.equal(s.passwords[key], NEXT[role], `${key} at ${at}`);
        for (const a of ACCOUNTS.filter((x) => x.role !== role)) assert.equal(s.passwords[a.key], CUR[a.role]);
        assert.equal(d.session.content.roles[role], NEXT[role]);
        assert.equal(s.mem.data.locks.length, 1, at);
        if (role === "leadership") assert.equal((await openSession({ store: s.store, password: CUR.leadership })).state, "locked", at);
      }
    }
  }
});

test("converge from every half state with recorded progress (applyChange, as in hiring)", async () => {
  const order = accountsFor(ROLES).map((a) => a.key);
  for (let k = 0; k <= order.length; k++) {
    for (const inProgressChanged of [false, true]) {
      const passwords = all();
      for (let i = 0; i < k; i++) passwords[order[i]] = NEXT[ACCOUNTS.find((a) => a.key === order[i]).role];
      const inProgress = order[k] || null;
      if (inProgress && inProgressChanged) passwords[inProgress] = NEXT[ACCOUNTS.find((a) => a.key === inProgress).role];
      const auth = fakeAuth({ passwords });
      const r = await applyChange(auth, ROLES, CUR, NEXTV, { progress: { done: order.slice(0, k), inProgress } });
      assert.equal(r.failedAt, null, `k=${k} changed=${inProgressChanged}: ${r.error && r.error.message}`);
      for (const key of order) assert.equal(passwords[key], NEXT[ACCOUNTS.find((a) => a.key === key).role], `${key} at k=${k}`);
    }
  }
});

test("a check after the change that couldn't connect is not a mismatch; Finish finishes from the new value", async () => {
  const s = await seeded();
  const flakyOnce = { n: 0 };
  const auth = { ...s.auth, async open(a, pw) {
    // the verify sign-in with the new value fails once on the network
    if (a.key === "hiring:committee" && pw === NEXT.ed && s.passwords[a.key] === NEXT.ed && flakyOnce.n++ === 0) throw Object.assign(new Error("net"), { code: "auth/network-request-failed" });
    return s.auth.open(a, pw);
  } };
  const r = await changePassword({ ...ctxOf(s), auth }, "ed", NEXT.ed);
  assert.equal(r.ok, false);
  assert.equal(r.stage, "verify");
  assert.deepEqual(r.bad.map((b) => [b.key, b.why]), [["hiring:committee", "error"]]);
  assert.deepEqual(s.session.content.pending.unsure, ["hiring:committee"]);
  assert.deepEqual(s.session.content.pending.done, ["voting:ed"]);
  s.auth.log.length = 0;
  const f = await finishChange({ ...ctxOf(s), auth });
  assert.equal(f.ok, true, f.error && f.error.message);
  assert.ok(!s.auth.log.includes("update hiring:committee"), "changed twice");
  assert.equal(s.session.content.roles.ed, NEXT.ed);
});

test("an account recorded as done that no longer takes the new value says so (not a loop of Finish)", async () => {
  const s = await seeded({ failUpdateOn: "hiring:committee" });
  await changePassword(ctxOf(s), "ed", NEXT.ed);
  s.passwords["voting:ed"] = "invented-console-value-10";     // changed in the console meanwhile
  const f = await finishChange(ctxOf(s));
  assert.equal(f.ok, false);
  assert.equal(f.failedAt, "voting:ed");
  assert.equal(f.error.code, "not-first-value");
  assert.equal(s.passwords["hiring:committee"], CUR.ed, "went on to change the others");
  assert.match(failureText(f.error, f.failedAt), /set-passwords\.py --apply/);
});

test("can't finish: a switched-off account and a password-rule refusal are named with the fix, and Finish works after", async () => {
  const s = await seeded();
  // switched off before anything changed: Check first says so and nothing changes
  s.auth.disabled.add("hiring:committee");
  const pre = await changePassword(ctxOf(s), "ed", NEXT.ed);
  assert.equal(pre.stage, "check");
  assert.deepEqual(pre.results.map((x) => [x.key, x.why || "ok"]), [["voting:ed", "ok"], ["hiring:committee", "disabled"]]);
  assert.equal(s.session.content.pending, null);
  // switched off part way: named with the console step
  s.auth.disabled.delete("hiring:committee");
  await startChange(ctxOf(s), "ed", NEXT.ed);
  s.auth.disabled.add("hiring:committee");
  const r = await runChange(ctxOf(s));
  assert.equal(r.ok, false);
  assert.deepEqual(r.done, ["voting:ed"]);
  assert.equal(failureText(r.error, r.failedAt), "Physician Hiring's ED account is switched off. Switch it on in the Firebase console (project mgh-ed-hiring, Authentication, Users), then press Finish.");
  assert.equal(canCancel(s.session), false, "something changed already");
  s.auth.disabled.delete("hiring:committee");
  assert.equal((await finishChange(ctxOf(s))).ok, true);
  const t = fakeAuth({ passwords: all(), ruleRefuses: "voting:ed" });
  const e = await converge(t, ACCOUNTS.find((a) => a.key === "voting:ed"), CUR.ed, NEXT.ed).catch((x) => x);
  assert.equal(failureText(e, "voting:ed"), "Motion Voting's ED account refused the new password because of its own password rules. Ask the maintainer: set-passwords.py --apply sets all three.");
});

test("part way, an account that takes neither value: the one in use is typed and goes into pending.from", async () => {
  const s = await seeded({ failUpdateOn: "voting:ed" });
  await changePassword(ctxOf(s), "ed", NEXT.ed);
  s.passwords["hiring:committee"] = "invented-console-value-11";
  const f = await finishChange(ctxOf(s));
  assert.equal(f.ok, false);
  assert.equal(f.failedAt, "hiring:committee");
  assert.equal(f.error.code, "refused");
  assert.equal((await fixAccount(ctxOf(s), "hiring:committee", "invented-wrong-12")).outcome, "refused");
  assert.equal((await fixAccount(ctxOf(s), "hiring:committee", "invented-console-value-11")).outcome, "saved");
  assert.equal(s.session.content.pending.from["hiring:committee"], "invented-console-value-11");
  assert.equal((await finishChange(ctxOf(s))).ok, true);
  assert.equal(s.passwords["hiring:committee"], NEXT.ed);
  assert.equal(s.session.content.pending, null, "the finish removes from");
});

// ---------------------------------------------------------------- two devices, cancel
test("two devices finishing at once: the second stops with changed-elsewhere before touching any account", async () => {
  const s = await seeded({ failUpdateOn: "hiring:committee" });
  await changePassword(ctxOf(s), "ed", NEXT.ed);
  const a = await device(s.store, s.auth, CUR.leadership);
  const b = await device(s.store, s.auth, CUR.leadership);
  assert.equal((await finishChange(a)).ok, true);
  s.auth.log.length = 0;
  const rb = await finishChange(b);
  assert.equal(rb.ok, false);
  assert.equal(rb.error.code, "changed-elsewhere");
  assert.equal(failureText(rb.error), "This was just changed on another device. Here is the latest.");
  assert.deepEqual(s.auth.log, [], "touched an account");
  await b.session.reload();
  assert.equal(b.session.content.pending, null);
  assert.equal(b.session.content.roles.ed, NEXT.ed);
});

test("another device's Save gets changed-elsewhere, and reloads the latest", async () => {
  const s = await seeded();
  const b = await device(s.store, s.auth, CUR.leadership);
  assert.equal((await changePassword(ctxOf(s), "guest", NEXT.guest)).ok, true);
  await assert.rejects(() => changePassword(b, "ed", NEXT.ed), (e) => e.code === "changed-elsewhere");
  assert.equal(s.passwords["voting:ed"], CUR.ed, "an account changed before the write failed");
  await b.session.reload();
  assert.equal(b.session.content.roles.guest, NEXT.guest);
});

test("Cancel only while nothing was touched; it drops pending (and for Leadership the NEW lock)", async () => {
  // ED: start, then cancel
  const s = await seeded();
  await startChange(ctxOf(s), "ed", NEXT.ed);
  assert.equal(canCancel(s.session), true);
  await cancelChange(ctxOf(s));
  assert.equal(s.session.content.pending, null);
  // Leadership: start (two locks), cancel (one lock, the old value opens, the new one doesn't)
  await startChange(ctxOf(s), "leadership", NEXT.leadership);
  assert.equal(s.mem.data.locks.length, 2);
  assert.equal(canCancel(s.session), true);
  await cancelChange(ctxOf(s));
  assert.equal(s.mem.data.locks.length, 1);
  assert.equal((await openSession({ store: s.store, password: NEXT.leadership })).state, "locked");
  assert.equal((await openSession({ store: s.store, password: CUR.leadership })).state, "open");
  // a device about to go on fails its next write before touching any account
  await startChange(ctxOf(s), "ed", NEXT.ed);
  const other = await device(s.store, s.auth, CUR.leadership);
  await cancelChange(other);
  s.auth.log.length = 0;
  const r = await runChange(ctxOf(s));
  assert.equal(r.error.code, "changed-elsewhere");
  assert.deepEqual(s.auth.log, []);
  // after something changed, no cancel
  const t = await seeded({ failUpdateOn: "hiring:committee" });
  await changePassword(ctxOf(t), "ed", NEXT.ed);
  assert.equal(canCancel(t.session), false);
  await assert.rejects(() => cancelChange(ctxOf(t)), (e) => e.code === "cannot-cancel");
  // in progress (recorded before the account) is not cancellable either
  const u = await seeded();
  await startChange(ctxOf(u), "ed", NEXT.ed);
  await u.session.write((x) => { x.pending.inProgress = "voting:ed"; return x; });
  assert.equal(canCancel(u.session), false);
});

// ---------------------------------------------------------------- Leadership (review M1)
test("Leadership: the OLD lock never holds the new value; the own account's done write drops it; at the end only NEW opens", async () => {
  const s = await seeded({ failUpdateOn: "voting:leadership" });
  const r = await changePassword(ctxOf(s), "leadership", NEXT.leadership);
  assert.equal(r.failedAt, "voting:leadership");
  // own account done: the old value no longer signs in, and the OLD lock is gone
  assert.equal(s.passwords[MAIN_KEY], NEXT.leadership);
  assert.equal(s.mem.data.locks.length, 1);
  assert.equal((await openSession({ store: s.store, password: CUR.leadership })).state, "locked");
  // the session goes on after its own updatePassword
  const f = await finishChange(ctxOf(s));
  assert.equal(f.ok, true, f.error && f.error.message);
  assert.equal(s.session.content.roles.leadership, NEXT.leadership);
});

test("Leadership stopped after the start write: OLD opens without the new value; Finish needs it typed again; a wrong value is refused", async () => {
  const s = await seeded({ failUpdateOn: MAIN_KEY });
  const r = await changePassword(ctxOf(s), "leadership", NEXT.leadership);
  assert.equal(r.failedAt, MAIN_KEY);
  assert.equal(s.passwords[MAIN_KEY], CUR.leadership);
  // NEW at the gate: the account refuses it (it still has OLD); OLD opens the OLD lock
  const old = await device(s.store, s.auth, CUR.leadership);
  assert.equal(old.session.content.pending.next, undefined);
  assert.ok(!JSON.stringify(old.session.content).includes(NEXT.leadership), "the new value is in the opened content");
  assert.equal(pendingText(old.session.content), "A Leadership change was started; nothing has changed yet.");
  await assert.rejects(() => finishChange(old), (e) => e.code === "needs-next");
  await assert.rejects(() => old.session.write((x) => x), (e) => e.code === "needs-next");
  // the quiet check with only the OLD lock: not-done accounts with the old value, nothing stale
  const q = await quietCheck(old);
  assert.deepEqual(q.stale, {});
  assert.deepEqual(q.finishing, []);
  await assert.rejects(() => old.session.unlockNext("invented-wrong-13"), (e) => e.code === "not-next");
  // Go on: the new value typed again opens the NEW lock, then the change continues
  await old.session.unlockNext(NEXT.leadership);
  assert.equal(old.session.content.pending.next, NEXT.leadership);
  const f = await finishChange(old);
  assert.equal(f.ok, true, f.error && f.error.message);
  for (const k of ORDER.leadership) assert.equal(s.passwords[k], NEXT.leadership);
  assert.equal(s.mem.data.locks.length, 1);
});

test("Leadership stopped after the start write, second device: Cancel from the OLD lock keeps one lock", async () => {
  const s = await seeded();
  await startChange(ctxOf(s), "leadership", NEXT.leadership);     // then the page was closed
  const old = await device(s.store, s.auth, CUR.leadership);
  assert.equal(old.session.missingLock, true);
  assert.equal(canCancel(old.session), true);
  await cancelChange(old);
  assert.equal(s.mem.data.locks.length, 1);
  assert.equal(old.session.content.pending, null);
  assert.equal((await openSession({ store: s.store, password: NEXT.leadership })).state, "locked");
});

test("Leadership stopped after the own account changed, before its write: NEW opens and Finish converges it as already", async () => {
  const s = await seeded({ loseAnswerOn: MAIN_KEY });
  const r = await changePassword(ctxOf(s), "leadership", NEXT.leadership);
  assert.equal(r.failedAt, MAIN_KEY);
  assert.equal(s.mem.data.locks.length, 2);
  assert.equal(s.passwords[MAIN_KEY], NEXT.leadership);
  const d = await device(s.store, s.auth, NEXT.leadership);
  assert.equal(d.session.content.pending.next, NEXT.leadership);
  assert.equal(canCancel(d.session), false);
  s.auth.log.length = 0;
  const f = await finishChange(d);
  assert.equal(f.ok, true, f.error && f.error.message);
  assert.ok(!s.auth.log.includes(`update ${MAIN_KEY}`), "the own account was changed twice");
  assert.equal(s.mem.data.locks.length, 1);
});

// ---------------------------------------------------------------- quiet check (B.6.4)
test("the quiet check: all fine; a stale account; skipped once refused; too-many-requests stops it", async () => {
  const s = await seeded();
  const q = await quietCheck(ctxOf(s));
  assert.equal(q.results.length, 6);
  assert.ok(q.results.every((x) => x.ok));
  s.passwords["voting:ed"] = "invented-console-value-14";
  const q2 = await quietCheck(ctxOf(s));
  assert.deepEqual(q2.stale, { ed: ["voting:ed"] });
  assert.equal(staleText("voting:ed"), "Motion Voting's ED account doesn't accept the saved ED password. Someone may have changed it another way.");
  s.auth.log.length = 0;
  const q3 = await quietCheck(ctxOf(s));
  assert.ok(!s.auth.log.includes("open voting:ed"), "a refused value was tried again");
  assert.ok(q3.results.find((x) => x.key === "voting:ed").skipped);
  s.auth.throttleOn = "hiring:admin";
  const q4 = await quietCheck({ ...ctxOf(s), guard: makeGuard() });
  assert.equal(q4.stopped, "throttled");
  assert.deepEqual(q4.results.map((x) => x.key), ["admin:leadership", "voting:leadership", "hiring:admin"]);
});

test("the quiet check during a pending change never reports stale for that role (finishing order)", async () => {
  const s = await seeded({ failUpdateOn: "hiring:committee" });
  await changePassword(ctxOf(s), "ed", NEXT.ed);
  const d = await device(s.store, s.auth, CUR.leadership);
  const c = d.session.content;
  assert.deepEqual(expectedFor(c, ACCOUNTS.find((a) => a.key === "voting:ed")).map((t) => t.kind), ["next"]);
  assert.deepEqual(expectedFor(c, ACCOUNTS.find((a) => a.key === "hiring:committee")).map((t) => t.kind), ["next", "old"]);
  const q = await quietCheck(d);
  assert.deepEqual(q.stale, {});
  assert.deepEqual(q.finishing, []);
  assert.ok(q.results.every((x) => x.ok));
  // an account of the pending role that takes neither: on the Finish line, never stale
  s.passwords["hiring:committee"] = "invented-console-value-15";
  const q2 = await quietCheck({ ...d, guard: makeGuard() });
  assert.deepEqual(q2.stale, {});
  assert.deepEqual(q2.finishing, ["hiring:committee"]);
});

// ---------------------------------------------------------------- stale flow (B.5.5)
test("stale: typed wrong; both changed to the same value (one write); typed equal to another role (not saved)", async () => {
  const s = await seeded();
  s.passwords["voting:ed"] = s.passwords["hiring:committee"] = "invented-break-glass-16";
  const q = await quietCheck(ctxOf(s));
  assert.deepEqual(q.stale, { ed: ["voting:ed", "hiring:committee"] });
  const status = Object.fromEntries(q.results.map((x) => [x.key, x.ok ? "ok" : "refused"]));
  const bad = await checkTyped(ctxOf(s), "ed", "voting:ed", "invented-wrong-17", { status });
  assert.equal(bad.outcome, "refused");
  assert.equal(TEXT.typedWrong, "That didn't work either. Check it was typed right.");
  const before = s.mem.writes;
  const ok = await checkTyped(ctxOf(s), "ed", "voting:ed", "invented-break-glass-16", { status });
  assert.equal(ok.outcome, "save");
  await saveStale(ctxOf(s), "ed", ok.value);
  assert.equal(s.mem.writes - before, 1);
  assert.equal(s.session.content.roles.ed, "invented-break-glass-16");
  // typed value equal to another role's: never saved
  s.passwords["hiring:applicant"] = CUR.leadership;
  const q2 = await quietCheck({ ...ctxOf(s), guard: makeGuard() });
  assert.deepEqual(q2.stale, { guest: ["hiring:applicant"] });
  const same = await checkTyped(ctxOf(s), "guest", "hiring:applicant", CUR.leadership, { status: { "hiring:applicant": "refused" } });
  assert.equal(same.outcome, "same-as-other");
  assert.equal(same.otherRole, "leadership");
  assert.equal(sameAsText("guest", "leadership"), "That is the same as the Leadership password, so Physician Hiring can't tell them apart. Set a new Guest password now.");
  await assert.rejects(() => saveStale(ctxOf(s), "guest", CUR.leadership), (e) => e.code === "invalid");
  assert.equal(s.session.content.roles.guest, CUR.guest);
  // so the Change opens with the typed value as the old one
  const r = await changePassword(ctxOf(s), "guest", NEXT.guest, { from: same.from });
  assert.equal(r.ok, true, r.error && r.error.message);
  assert.equal(s.passwords["hiring:applicant"], NEXT.guest);
});

test("stale: the role's accounts now differ, Change opens at once with from; Save; both new; no trace of the old value", async () => {
  const s = await seeded();
  s.passwords["voting:ed"] = "invented-console-value-18";
  const q = await quietCheck(ctxOf(s));
  const status = Object.fromEntries(q.results.map((x) => [x.key, x.ok ? "ok" : "refused"]));
  const d = await checkTyped(ctxOf(s), "ed", "voting:ed", "invented-console-value-18", { status });
  assert.equal(d.outcome, "differ");
  assert.deepEqual(d.from, { "voting:ed": "invented-console-value-18" });
  assert.equal(differText("ed", d.from), "Motion Voting and Physician Hiring have different ED passwords. Set one new ED password for both now.");
  // the new value may not be the typed one
  assert.ok(validateChange(s.session.content, "ed", "invented-console-value-18", "invented-console-value-18", d.from).length);
  const r = await changePassword(ctxOf(s), "ed", NEXT.ed, { from: d.from });
  assert.equal(r.ok, true, r.error && r.error.message);
  assert.equal(s.passwords["voting:ed"], NEXT.ed);
  assert.equal(s.passwords["hiring:committee"], NEXT.ed);
  const fresh = await device(s.store, s.auth, CUR.leadership);
  assert.ok(!JSON.stringify(fresh.session.content).includes("invented-console-value-18"));
});

test("stale: not every account known yet asks for the next one", async () => {
  const s = await seeded();
  s.passwords["voting:ed"] = "invented-console-value-19";
  s.passwords["hiring:committee"] = "invented-console-value-20";
  const q = await quietCheck(ctxOf(s));
  const status = Object.fromEntries(q.results.map((x) => [x.key, x.ok ? "ok" : "refused"]));
  const first = await checkTyped(ctxOf(s), "ed", "voting:ed", "invented-console-value-19", { status });
  assert.equal(first.outcome, "need-more");
  assert.deepEqual(first.keys, ["hiring:committee"]);
  const second = await checkTyped(ctxOf(s), "ed", "hiring:committee", "invented-console-value-20", { status, known: first.known });
  assert.equal(second.outcome, "differ");
  assert.deepEqual(Object.keys(second.from).sort(), ["hiring:committee", "voting:ed"]);
  await assert.rejects(() => checkTyped(ctxOf(s), "ed", "hiring:admin", "x"), (e) => e.code === "not-needed");
});

test("stale flow is never offered for the role of a pending change", async () => {
  const s = await seeded({ failUpdateOn: "hiring:committee" });
  await changePassword(ctxOf(s), "ed", NEXT.ed);
  await assert.rejects(() => checkTyped(ctxOf(s), "ed", "voting:ed", "x"), (e) => e.code === "pending-role");
});

// ---------------------------------------------------------------- first use and recovery (B.5.6)
test("first use: every account proven, then one lock, gen 1, no value in clear", async () => {
  const mem = memFirestore();
  const store = makeStore(mem.fs, mem.db);
  assert.equal((await openSession({ store, password: CUR.leadership })).state, "first-use");
  const passwords = all();
  const auth = fakeAuth({ passwords });
  const r = await firstUse({ auth, store, mainValue: CUR.leadership }, { ed: CUR.ed, guest: CUR.guest });
  assert.equal(r.outcome, "saved");
  assert.deepEqual(r.differ, {});
  assert.equal(mem.data.gen, 1);
  assert.equal(mem.data.locks.length, 1);
  assert.deepEqual(auth.log, ACCOUNTS.filter((a) => !a.main).map((a) => `open ${a.key}`));
  for (const v of Object.values(CUR)) assert.ok(!mem.raw.join().includes(v));
  const o = await openSession({ store, password: CUR.leadership });
  assert.deepEqual(o.session.content.roles, CUR);
  assert.equal(TEXT.firstUse.includes("First time here."), true);
});

test("first use: a refused account gets the stale dialog; then a role not the same everywhere opens its Change", async () => {
  const mem = memFirestore();
  const store = makeStore(mem.fs, mem.db);
  const passwords = all();
  passwords["hiring:committee"] = "invented-console-value-21";
  const auth = fakeAuth({ passwords });
  const ctx = { auth, store, mainValue: CUR.leadership, guard: makeGuard() };
  const r1 = await firstUse(ctx, { ed: CUR.ed, guest: CUR.guest });
  assert.equal(r1.outcome, "refused");
  assert.deepEqual(r1.keys, ["hiring:committee"]);
  assert.equal(mem.writes, 0);
  auth.log.length = 0;
  const r2 = await firstUse(ctx, { ed: CUR.ed, guest: CUR.guest }, { overrides: { "hiring:committee": "invented-console-value-21" }, proven: r1.proven });
  assert.deepEqual(auth.log, ["open hiring:committee"], "proven accounts were tried again");
  assert.equal(r2.outcome, "saved");
  assert.deepEqual(r2.differ, { ed: { "hiring:committee": "invented-console-value-21" } });
  assert.equal(r2.session.content.roles.ed, CUR.ed);
  const c = await changePassword({ auth, session: r2.session, guard: makeGuard(), now }, "ed", NEXT.ed, { from: r2.differ.ed });
  assert.equal(c.ok, true, c.error && c.error.message);
  assert.equal(passwords["hiring:committee"], NEXT.ed);
});

test("first use: typed values the same, or an ED equal to Leadership, are refused before any sign-in", async () => {
  const mem = memFirestore();
  const auth = fakeAuth({ passwords: all() });
  const ctx = { auth, store: makeStore(mem.fs, mem.db), mainValue: CUR.leadership };
  assert.equal((await firstUse(ctx, { ed: CUR.ed, guest: CUR.ed })).outcome, "invalid");
  assert.equal((await firstUse(ctx, { ed: CUR.leadership, guest: CUR.guest })).outcome, "invalid");
  assert.equal((await firstUse(ctx, { ed: "", guest: CUR.guest })).outcome, "invalid");
  assert.deepEqual(auth.log, []);
});

test("recovery: a vault locked with another Leadership value is replaced (gen + 1)", async () => {
  const s = await seeded();
  // Leadership changed outside this page (console); the vault still has the old lock
  for (const k of ORDER.leadership) s.passwords[k] = "invented-console-lead-22";
  const o = await openSession({ store: s.store, password: "invented-console-lead-22" });
  assert.equal(o.state, "locked");
  assert.equal(o.reason, "old-password");
  assert.equal(o.expectGen, 1);
  assert.equal(TEXT.recovery, "The saved copy was locked with an older Leadership password. Type the ED and Guest passwords in use now to make a new copy.");
  const r = await firstUse({ auth: s.auth, store: s.store, mainValue: "invented-console-lead-22", expectGen: o.expectGen }, { ed: CUR.ed, guest: CUR.guest });
  assert.equal(r.outcome, "saved");
  assert.equal(s.mem.data.gen, 2);
  assert.equal(r.session.content.roles.leadership, "invented-console-lead-22");
  assert.equal((await openSession({ store: s.store, password: CUR.leadership })).state, "locked");
});

test("a document the page would never write is treated as locked, not opened", async () => {
  const s = await seeded();
  s.mem.data.locks = [{ ...s.mem.data.locks[0], iter: 1000 }];
  const o = await openSession({ store: s.store, password: CUR.leadership });
  assert.equal(o.state, "locked");
  assert.equal(o.reason, "refused");
});

// ---------------------------------------------------------------- the Firebase adapter and the gate
const sdkFake = (over = {}) => {
  const asked = [];
  const sdk = {
    asked,
    initializeApp: (c, name) => ({ name, c }), deleteApp: async () => { asked.push("deleteApp"); }, inMemoryPersistence: { type: "NONE" },
    initializeAuth: (app, opts) => { asked.push(opts.persistence.type); return { app }; },
    signInWithEmailAndPassword: async (auth, email) => ({ user: { email, uid: (ACCOUNTS.find((a) => a.email === email) || {}).uid } }),
    updatePassword: async () => {}, signOut: async () => { asked.push("signOut"); },
    reauthenticateWithCredential: async (u, c) => { asked.push("reauth:" + c.e); }, EmailAuthProvider: { credential: (e, p) => ({ e, p }) },
    ...over,
  };
  return sdk;
};
const MAIN_TEST = { ...ACCOUNTS[0], uid: "invented-admin-uid" };

test("helpers keep their sign-in in memory only, closed at once; the page's own account is re-authenticated by uid", async () => {
  const sdk = sdkFake();
  const ad = makeFirebaseAdapter(sdk, { mainAuth: { currentUser: { email: MAIN_TEST.email, uid: MAIN_TEST.uid } }, configs: { hiring: {}, voting: {}, admin: {} } });
  await ad.close(await ad.open(MAIN_TEST, "x"));
  for (const a of ACCOUNTS.slice(1)) await ad.close(await ad.open(a, "x"));
  assert.deepEqual(sdk.asked.filter((x) => x !== "signOut" && x !== "deleteApp"), ["reauth:" + MAIN_TEST.email, "NONE", "NONE", "NONE", "NONE", "NONE"]);
  assert.equal(sdk.asked.filter((x) => x === "deleteApp").length, 5);
});

test("a helper sign-in that lands on another uid is a refusal, and its app is closed", async () => {
  const sdk = sdkFake({ signInWithEmailAndPassword: async (auth, email) => ({ user: { email, uid: "someone-else" } }) });
  const ad = makeFirebaseAdapter(sdk, { mainAuth: null, configs: { hiring: {}, voting: {} } });
  await assert.rejects(() => ad.open(ACCOUNTS[1], "x"), (e) => e.code === "auth/invalid-credential");
  assert.ok(sdk.asked.includes("signOut") && sdk.asked.includes("deleteApp"));
});

test("the page's own account: an empty uid is not set up yet; another signed-in uid is signed out", async () => {
  const ad = makeFirebaseAdapter(sdkFake(), { mainAuth: { currentUser: { uid: "someone-else" } } });
  await assert.rejects(() => ad.open(ACCOUNTS[0], "x"), (e) => e.code === "not-set-up");
  await assert.rejects(() => ad.open(MAIN_TEST, "x"), (e) => e.code === "signed-out");
});

test("the gate: not set up yet with an empty admin uid; only the pinned uid opens; plain messages", async () => {
  assert.equal(isSetUp(), false, "config.js has no admin account yet");
  await assert.rejects(() => signInGate(sdkFake(), {}, "x"), (e) => e.code === "not-set-up");
  assert.equal(signInError({ code: "not-set-up" }), "This page is not ready yet. Ask the person who looks after the ED tools to finish setting it up.");
  const wrong = sdkFake({ signInWithEmailAndPassword: async () => ({ user: { uid: "someone-else" } }) });
  await assert.rejects(() => signInGate(wrong, {}, "x", { account: MAIN_TEST, ready: () => true }), (e) => e.code === "auth/invalid-credential");
  assert.ok(wrong.asked.includes("signOut"));
  const right = sdkFake({ signInWithEmailAndPassword: async () => ({ user: { uid: MAIN_TEST.uid } }) });
  assert.equal((await signInGate(right, {}, "x", { account: MAIN_TEST, ready: () => true })).uid, MAIN_TEST.uid);
  assert.equal(signInError({ code: "auth/invalid-credential" }), "Incorrect password.");
  assert.match(signInError({ code: "auth/too-many-requests" }), /15 minutes/);
});

test("the gate: 3 wrong tries, then a 30-second wait; a right one clears it", () => {
  const m = new Map();
  const ls = { get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v), del: (k) => m.delete(k) };
  assert.equal(gateWrong(ls, 0), false);
  assert.equal(gateWrong(ls, 1), false);
  assert.equal(gateWrong(ls, 2), true);
  assert.equal(gatePausedFor(ls, 2), 30000);
  assert.equal(gatePausedFor(ls, 30002), 0);
  gateRight(ls);
  assert.equal(m.size, 0);
});

// ---------------------------------------------------------------- the leak test
test("no password value ever reaches the console, storage, an error message, or the vault in clear", async () => {
  const seen = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  for (const k of Object.keys(orig)) console[k] = (...a) => seen.push(a.map(String).join(" "));
  const stored = []; const stor = { setItem: (k, v) => stored.push(String(k) + String(v)), getItem: () => null, removeItem() {} };
  globalThis.localStorage = stor; globalThis.sessionStorage = stor;
  globalThis.indexedDB = { open: (...a) => { stored.push(a.join()); return {}; } };
  const values = [...Object.values(CUR), ...Object.values(NEXT), "invented-console-value-23"];
  const errors = [];
  try {
    const s = await seeded({ failUpdateOn: "hiring:applicant" });
    errors.push(await changePassword(ctxOf(s), "guest", NEXT.guest));
    errors.push(await finishChange(ctxOf(s)));
    s.passwords["voting:ed"] = "invented-console-value-23";
    const q = await quietCheck(ctxOf(s));
    const status = Object.fromEntries(q.results.map((x) => [x.key, x.ok ? "ok" : "refused"]));
    const d = await checkTyped(ctxOf(s), "ed", "voting:ed", "invented-console-value-23", { status });
    errors.push(await changePassword(ctxOf(s), "ed", NEXT.ed, { from: d.from }));
    const t = await seeded({ failUpdateOn: "voting:leadership" });
    errors.push(await changePassword(ctxOf(t), "leadership", NEXT.leadership));
    errors.push(await finishChange(ctxOf(t)));
    const bad = await startChange(ctxOf(t), "ed", CUR.guest).catch((e) => e);
    errors.push(bad);
    const raw = [...s.mem.raw, ...t.mem.raw].join("\n");
    const said = errors.map((e) => JSON.stringify({ m: e && e.message, e: e && e.error && e.error.message, x: e && e.errors })).join("\n");
    const texts = [failureText({ code: "refused" }, "voting:ed"), staleText("voting:ed"), pendingText(t.session.content), JSON.stringify(doneText("ed"))].join("\n");
    const everything = [...seen, ...stored, raw, said, texts].join("\n");
    for (const v of values) assert.ok(!everything.includes(v), "a password leaked");
    assert.equal(seen.length, 0, "something was logged");
    assert.equal(stored.length, 0, "something was stored in the browser");
  } finally { Object.assign(console, orig); delete globalThis.localStorage; delete globalThis.sessionStorage; delete globalThis.indexedDB; }
});

test("the guard: refusals remembered per account and value, forgotten when a person types", async () => {
  const g = makeGuard();
  const passwords = all();
  const ad = guarded(fakeAuth({ passwords }), g, { skipKnown: true });
  const a = ACCOUNTS.find((x) => x.key === "voting:ed");
  await assert.rejects(() => ad.open(a, "invented-wrong-24"));
  assert.equal(g.refusedBefore("voting:ed", "invented-wrong-24"), true);
  await assert.rejects(() => ad.open(a, "invented-wrong-24"), (e) => e.known === true);
  g.forget("voting:ed");
  assert.equal(g.refusedBefore("voting:ed", "invented-wrong-24"), false);
  const s = await ad.open(a, CUR.ed);
  await ad.update(s, NEXT.ed);
  await ad.close(s);
  assert.equal(passwords["voting:ed"], NEXT.ed);
});

test("words: the Done message has no password and the warnings follow hiring", () => {
  assert.deepEqual(doneText("leadership"), {
    works: "The new Leadership password works in Motion Voting, Physician Hiring and the Patient Hub statistics page.",
    note: "The Leadership password for the ED tools changed today. Ask ED leadership for the new one.",
    tell: "Tell people in person or by phone. Never email a password.",
  });
  assert.equal(doneText("guest").works, "The new Guest password works in Physician Hiring.");
  assert.equal(differText("leadership", {}), "The ED tools passwords page, Motion Voting and Physician Hiring have different Leadership passwords. Set one new Leadership password for all of them now.");
  assert.equal(sameAsText("ed", "leadership"), "That is the same as the Leadership password, so Motion Voting and Physician Hiring can't tell them apart. Set a new ED password now.");
});
