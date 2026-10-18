// store.js and core.js against the Firestore emulator and the real rules,
// with the Firestore lite SDK (as the page uses), signed in as the pinned
// uid by a mock token. The auth side is the unit tests' fake (the Auth
// emulator comes with the page flows). Every value is invented.
import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { initializeApp, deleteApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator, doc, getDoc, runTransaction, serverTimestamp } from "firebase/firestore/lite";
import { makeStore } from "../../store.js";
import { openSession, firstUse, changePassword, finishChange, makeGuard } from "../../core.js";
import { CUR, NEXT, all, fakeAuth } from "../unit/fakes.mjs";
import { PROJECT, TEST_UID, ADMIN_EMAIL, EMU, rulesForTest } from "./helpers.mjs";

let env; const apps = [];
before(async () => { env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: rulesForTest(), host: EMU.host, port: EMU.port } }); });
after(async () => { for (const a of apps) await deleteApp(a); if (env) await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

// a page's Firestore, signed in as uid
function storeAs(uid) {
  const app = initializeApp({ projectId: PROJECT, apiKey: "demo-key" }, `t${apps.length}`);
  apps.push(app);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, EMU.host, EMU.port, { mockUserToken: { user_id: uid, sub: uid, email: ADMIN_EMAIL, firebase: { sign_in_provider: "password" } } });
  return makeStore({ doc, getDoc, runTransaction, serverTimestamp }, db);
}
const now = () => "2026-10-17T12:00:00.000Z";

test("first use, every role's change and a Leadership change all pass the real rules", async () => {
  const store = storeAs(TEST_UID);
  const passwords = all();
  const auth = fakeAuth({ passwords });
  const r = await firstUse({ auth, store, mainValue: CUR.leadership }, { ed: CUR.ed, guest: CUR.guest });
  assert.equal(r.outcome, "saved");
  const ctx = { auth, session: r.session, guard: makeGuard(), now };
  for (const role of ["ed", "guest", "leadership"]) {
    const c = await changePassword(ctx, role, NEXT[role]);
    assert.equal(c.ok, true, `${role}: ${c.error && c.error.code}`);
  }
  const raw = await store.read();
  assert.equal(raw.gen, 1 + 6 + 4 + 8);
  assert.equal(raw.locks.length, 1);
  for (const v of [...Object.values(CUR), ...Object.values(NEXT)]) assert.ok(!JSON.stringify(raw).includes(v));
  assert.equal((await openSession({ store, password: CUR.leadership })).state, "locked");
  const o = await openSession({ store, password: NEXT.leadership });
  assert.deepEqual(o.session.content.roles, NEXT);
});

test("two devices: the second write is changed-elsewhere, before any account is touched", async () => {
  const a = storeAs(TEST_UID), b = storeAs(TEST_UID);
  const passwords = all();
  const auth = fakeAuth({ passwords, failUpdateOn: "hiring:committee" });
  const r = await firstUse({ auth, store: a, mainValue: CUR.leadership }, { ed: CUR.ed, guest: CUR.guest });
  await changePassword({ auth, session: r.session, guard: makeGuard(), now }, "ed", NEXT.ed);
  const da = (await openSession({ store: a, password: CUR.leadership })).session;
  const db = (await openSession({ store: b, password: CUR.leadership })).session;
  assert.equal((await finishChange({ auth, session: da, guard: makeGuard(), now })).ok, true);
  auth.log.length = 0;
  const rb = await finishChange({ auth, session: db, guard: makeGuard(), now });
  assert.equal(rb.error.code, "changed-elsewhere");
  assert.deepEqual(auth.log, []);
  await db.reload();
  assert.equal(db.content.roles.ed, NEXT.ed);
});

test("another uid with the same email can't read or write through store.js", async () => {
  const mine = storeAs(TEST_UID), theirs = storeAs("SomeoneElse0000000000000002");
  const auth = fakeAuth({ passwords: all() });
  await firstUse({ auth, store: mine, mainValue: CUR.leadership }, { ed: CUR.ed, guest: CUR.guest });
  await assert.rejects(() => theirs.read(), (e) => /permission/i.test(String(e.code)));
  await assert.rejects(() => theirs.write(1, async () => ({ v: 1, gen: 2, locks: [{ salt: "S".repeat(24), iter: 600000, iv: "I".repeat(16), ct: "C" }] })),
    (e) => /permission/i.test(String(e.code)));
});
