// Review round 1: one test (or more) for each fix in core.js and vault.js.
// Every value is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNTS, MAIN_KEY, openSession, firstUse, changePassword, finishChange, canCancel, cancelChange, pendingText, quietCheck,
  makeGuard, expectedFor, preflight, validateChange, checkTyped, startChange, TEXT, changeWarnings, failureText, signInError, checkFailText,
} from "../../core.js";
import { makeLock, seal, openVault, toB64, fromB64 } from "../../vault.js";
import { makeStore } from "../../store.js";
import { CUR, NEXT, all, fakeAuth, memFirestore } from "./fakes.mjs";

const now = () => "2026-10-18T12:00:00.000Z";
const X = "invented-chosen-value-9";
const LEAD_KEYS = ACCOUNTS.filter((a) => a.role === "leadership").map((a) => a.key);
async function honestVault() {
  const mem = memFirestore();
  const store = makeStore(mem.fs, mem.db);
  const passwords = all();
  const auth = fakeAuth({ passwords });
  const r = await firstUse({ auth, store, mainValue: CUR.leadership }, { ed: CUR.ed, guest: CUR.guest });
  return { mem, store, passwords, auth, session: r.session };
}
const forgedPending = { role: "leadership", next: X, startedAt: now(), done: [], inProgress: null, unsure: [] };

// ---- S-M1: someone who knows only the OLD Leadership password plants a change
test("S-M1: a forged one-lock change (next under the OLD key) is shown as nothing changed yet; Finish refuses; Cancel cleans it", async () => {
  const v = await honestVault();
  const lock = await makeLock(CUR.leadership);
  await v.store.write(1, async () => ({ v: 1, gen: 2, locks: await seal({ roles: CUR, changedAt: {}, pending: forgedPending }, [lock], 2) }));
  const o = await openSession({ store: v.store, password: CUR.leadership });
  const s = o.session;
  assert.equal(s.content.pending.next, undefined, "the planted value is trusted");
  assert.ok(!JSON.stringify(s.content).includes(X));
  assert.equal(pendingText(s.content), "A Leadership change was started; nothing has changed yet.");
  await assert.rejects(() => finishChange({ auth: v.auth, session: s, guard: makeGuard(), now }), (e) => e.code === "needs-next");
  assert.equal(canCancel(s), true);
  for (const k of LEAD_KEYS) assert.equal(v.passwords[k], CUR.leadership);
  await cancelChange({ session: s });
  const back = await openVault(v.mem.data, CUR.leadership);
  assert.equal(back.content.pending, null);
  assert.equal(v.mem.data.locks.length, 1);
});

test("S-M1: a forged two-lock change (OLD lock holds next, plus a lock made from it) also needs the value typed, and Cancel drops the extra lock", async () => {
  const v = await honestVault();
  const a = await makeLock(CUR.leadership), b = await makeLock(X);
  await v.store.write(1, async () => ({ v: 1, gen: 2, locks: await seal({ roles: CUR, changedAt: {}, pending: forgedPending }, [a, b], 2) }));
  const s = (await openSession({ store: v.store, password: CUR.leadership })).session;
  assert.equal(s.content.pending.next, undefined);
  assert.equal(s.missingLock, true);
  await assert.rejects(() => finishChange({ auth: v.auth, session: s, guard: makeGuard(), now }), (e) => e.code === "needs-next");
  await assert.rejects(() => s.unlockNext("invented-guess-10"), (e) => e.code === "not-next");
  assert.equal(canCancel(s), true);
  await cancelChange({ session: s });
  assert.equal(v.mem.data.locks.length, 1);
  assert.equal(await openVault(v.mem.data, X), null);
});

test("S-M1: a forged change written under this tab's own salt is caught on reload too (no password at hand)", async () => {
  const v = await honestVault();
  const s = v.session;
  const reused = await makeLock(CUR.leadership, { salt: s.locks[0].salt, iter: s.locks[0].iter });
  await v.store.write(1, async () => ({ v: 1, gen: 2, locks: await seal({ roles: CUR, changedAt: {}, pending: forgedPending }, [reused], 2) }));
  await assert.rejects(() => startChange({ session: s, now }, "ed", NEXT.ed), (e) => e.code === "changed-elsewhere");
  await s.reload();
  assert.equal(s.content.pending.next, undefined);
  await assert.rejects(() => finishChange({ auth: v.auth, session: s, guard: makeGuard(), now }), (e) => e.code === "needs-next");
});

test("S-M1: an honest change still finishes from a fresh device that signs in with the new value", async () => {
  const v = await honestVault();
  v.auth.failUpdateOn = "voting:leadership";
  const r = await changePassword({ auth: v.auth, session: v.session, guard: makeGuard(), now }, "leadership", NEXT.leadership);
  assert.equal(r.ok, false);
  const s = (await openSession({ store: v.store, password: NEXT.leadership })).session;
  assert.equal(s.content.pending.next, NEXT.leadership);
  assert.equal((await finishChange({ auth: v.auth, session: s, guard: makeGuard(), now })).ok, true);
  for (const k of LEAD_KEYS) assert.equal(v.passwords[k], NEXT.leadership);
});

// ---- L-M1: an account that may have the new value is never "nothing changed"
test("L-M1: after a check that couldn't confirm an account, a fresh device offers no Cancel, and Finish completes", async () => {
  const v = await honestVault();
  let n = 0;
  const flaky = { ...v.auth, async open(a, pw) {
    if (a.key === "hiring:applicant" && pw === NEXT.guest && v.passwords[a.key] === NEXT.guest && n++ === 0) throw Object.assign(new Error("net"), { code: "auth/network-request-failed" });
    return v.auth.open(a, pw);
  } };
  const r = await changePassword({ auth: flaky, session: v.session, guard: makeGuard(), now }, "guest", NEXT.guest);
  assert.equal(r.stage, "verify");
  const s = (await openSession({ store: v.store, password: CUR.leadership })).session;
  assert.deepEqual(s.content.pending.done, ["hiring:applicant"]);
  assert.deepEqual(s.content.pending.unsure, ["hiring:applicant"]);
  assert.equal(canCancel(s), false);
  await assert.rejects(() => cancelChange({ session: s }), (e) => e.code === "cannot-cancel");
  assert.deepEqual(expectedFor(s.content, ACCOUNTS.find((a) => a.key === "hiring:applicant")).map((t) => t.kind), ["next", "old"]);
  const q = await quietCheck({ auth: v.auth, session: s, guard: makeGuard() });
  assert.deepEqual(q.stale, {});
  assert.deepEqual(q.finishing, []);
  assert.equal((await finishChange({ auth: v.auth, session: s, guard: makeGuard(), now })).ok, true);
  assert.equal(s.content.roles.guest, NEXT.guest);
});

// ---- minor 1: check first proves the other roles' hiring accounts; typed values are in use
test("m1: Check first also proves the Physician Hiring account of each other role", async () => {
  const auth = fakeAuth({ passwords: all() });
  const r = await preflight(auth, ["ed"], CUR);
  assert.deepEqual(r.results.map((x) => x.key), ["voting:ed", "hiring:committee", "hiring:admin", "hiring:applicant"]);
  const bad = await preflight(fakeAuth({ passwords: all() }), ["ed"], { ...CUR, guest: "invented-not-guest-11" });
  assert.equal(bad.ok, false);
  assert.equal(bad.results[bad.results.length - 1].key, "hiring:applicant");
  assert.equal(checkFailText("refused", "hiring:applicant"), "Physician Hiring's Guest account doesn't accept the saved Guest password. Someone may have changed it another way.");
});

test("m1: a value typed in this tab for any row counts as in use", () => {
  const content = { roles: CUR, pending: null };
  assert.deepEqual(validateChange(content, "ed", NEXT.ed, NEXT.ed, {}, []), []);
  assert.deepEqual(validateChange(content, "ed", NEXT.ed, NEXT.ed, {}, new Set([NEXT.ed])), [TEXT.typedEarlier]);
});

// ---- minor 10: no stale flow on any row while a change is pending
test("m10: the stale flow is refused for every row while any change is pending", async () => {
  const v = await honestVault();
  await startChange({ session: v.session, now }, "guest", NEXT.guest);
  await assert.rejects(() => checkTyped({ auth: v.auth, session: v.session, guard: makeGuard() }, "ed", "voting:ed", "x"), (e) => e.code === "pending-other" && e.message === "Finish or cancel the Guest change first.");
});

// ---- minor 4: a salt or IV that doesn't decode or has the wrong size is refused
test("m4: a bad salt or IV is vault-refused (the page offers a new copy), not a network error", async () => {
  const lock = await makeLock(CUR.leadership);
  const [l] = await seal({ roles: CUR, pending: null, changedAt: {} }, [lock], 1);
  const doc = (x) => ({ v: 1, gen: 1, locks: [{ ...l, ...x }] });
  for (const bad of [{ salt: "!!not base64!!" }, { salt: toB64(new Uint8Array(8)) + "A".repeat(0) }, { iv: toB64(new Uint8Array(11)) }, { iv: "%%%" }, { ct: "%%%" }]) {
    await assert.rejects(() => openVault(doc(bad), CUR.leadership), (e) => e.code === "vault-refused", JSON.stringify(Object.keys(bad)));
  }
  assert.equal(fromB64(l.iv).length, 12);
  const mem = memFirestore();
  const store = makeStore(mem.fs, mem.db);
  mem.data = doc({ salt: "!!not base64!!" });
  const o = await openSession({ store, password: CUR.leadership });
  assert.equal(o.state, "locked");
  assert.equal(o.reason, "refused");
});

// ---- minor 15, 16: words
test("m15/m16: plain words; no script name or 'maintainer' in anything the page shows; one wording for the pause", () => {
  assert.equal(changeWarnings("guest")[0], "Applicants who have the old Guest password won't be able to sign in. Tell them the new one in person or by phone.");
  assert.ok(!TEXT.recovery.includes("locked"));
  const shown = [...Object.values(TEXT), ...ACCOUNTS.flatMap((a) => ["refused", "not-first-value", "mismatch", "auth/user-disabled", "auth/weak-password", "auth/too-many-requests", "x"]
    .map((code) => failureText({ code }, a.key))), signInError({ code: "auth/too-many-requests" })];
  for (const t of shown) assert.ok(!/set-passwords|maintainer|\.py\b/.test(t), t);
  assert.equal(failureText({ code: "auth/too-many-requests" }, "voting:ed"), TEXT.throttled);
  assert.equal(signInError({ code: "auth/too-many-requests" }), TEXT.throttled);
  assert.equal(MAIN_KEY, "admin:leadership");
});
