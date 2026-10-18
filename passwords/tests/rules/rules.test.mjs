// The vault rules (design B.4, B.8.2) against the Firestore emulator. Nothing
// here talks to a real project, and no value in it is a password.
import { before, after, beforeEach, describe, it } from "node:test";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { PROJECT, TEST_UID, ADMIN_EMAIL, EMU, rulesForTest, pw } from "./helpers.mjs";
import { ACCOUNTS } from "../../config.js";

let env;
before(async () => { env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: rulesForTest(), host: EMU.host, port: EMU.port } }); });
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const uidOf = (k) => ACCOUNTS.find((a) => a.key === k).uid;
const emailOf = (k) => ACCOUNTS.find((a) => a.key === k).email;
const leader = () => env.authenticatedContext(TEST_UID, pw(ADMIN_EMAIL)).firestore();
const sameEmailOtherUid = () => env.authenticatedContext("SomeoneElse0000000000000001", pw(ADMIN_EMAIL)).firestore();
const hiringAdmin = () => env.authenticatedContext(uidOf("hiring:admin"), pw(emailOf("hiring:admin"))).firestore();
const votingEd = () => env.authenticatedContext(uidOf("voting:ed"), pw(emailOf("voting:ed"))).firestore();
const asAnonymous = () => env.authenticatedContext(TEST_UID, { email: ADMIN_EMAIL, firebase: { sign_in_provider: "anonymous" } }).firestore();
const asCustom = () => env.authenticatedContext(TEST_UID, { email: ADMIN_EMAIL, firebase: { sign_in_provider: "custom" } }).firestore();
const signedOut = () => env.unauthenticatedContext().firestore();

const lock = (over = {}) => ({ salt: "S".repeat(24), iter: 600000, iv: "I".repeat(16), ct: "C".repeat(1400), ...over });
const good = (gen = 1, over = {}) => ({ v: 1, gen, updatedAt: serverTimestamp(), locks: [lock()], ...over });
const vault = (db) => doc(db, "vault/main");
async function seed(gen = 1) {
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "vault/main"), { v: 1, gen, updatedAt: Timestamp.now(), locks: [lock()] }); });
}

describe("the pinned Leadership uid, signed in with a password", () => {
  it("reads vault/main", async () => { await seed(); await assertSucceeds(getDoc(vault(leader()))); });
  it("creates it with gen 1 only", async () => {
    await assertFails(setDoc(vault(leader()), good(2)));
    await assertFails(setDoc(vault(leader()), good(0)));
    await assertSucceeds(setDoc(vault(leader()), good(1)));
  });
  it("updates it with gen + 1 only", async () => {
    await seed(3);
    await assertFails(setDoc(vault(leader()), good(3)));
    await assertFails(setDoc(vault(leader()), good(5)));
    await assertFails(setDoc(vault(leader()), good(2)));
    await assertSucceeds(setDoc(vault(leader()), good(4)));
    await assertSucceeds(updateDoc(vault(leader()), { gen: 5, updatedAt: serverTimestamp() }));
  });
  it("two locks are fine", async () => { await assertSucceeds(setDoc(vault(leader()), good(1, { locks: [lock(), lock({ salt: "T".repeat(24) })] }))); });
  it("never lists or deletes", async () => {
    await seed();
    await assertFails(getDocs(collection(leader(), "vault")));
    await assertFails(deleteDoc(vault(leader())));
  });
  it("nothing else anywhere", async () => {
    await assertFails(setDoc(doc(leader(), "vault/other"), good(1)));
    await assertFails(getDoc(doc(leader(), "vault/other")));
    await assertFails(setDoc(doc(leader(), "other/main"), good(1)));
    await assertFails(getDoc(doc(leader(), "anything/at/all/deep")));
  });
});

describe("shape refusals", () => {
  const cases = {
    "an extra key": good(1, { note: "x" }),
    "no updatedAt": (() => { const d = good(1); delete d.updatedAt; return d; })(),
    "no locks": (() => { const d = good(1); delete d.locks; return d; })(),
    "v is 2": good(1, { v: 2 }),
    "gen is a string": good(1, { gen: "1" }),
    "updatedAt is not the server time": good(1, { updatedAt: Timestamp.fromMillis(1000) }),
    "0 locks": good(1, { locks: [] }),
    "3 locks": good(1, { locks: [lock(), lock(), lock()] }),
    "an extra lock key": good(1, { locks: [lock({ note: "x" })] }),
    "a missing lock key": good(1, { locks: [(() => { const l = lock(); delete l.iv; return l; })()] }),
    "iter 1000": good(1, { locks: [lock({ iter: 1000 })] }),
    "iter above 10,000,000": good(1, { locks: [lock({ iter: 10000001 })] }),
    "iter as a string": good(1, { locks: [lock({ iter: "600000" })] }),
    "a second lock that is wrong": good(1, { locks: [lock(), lock({ iter: 1000 })] }),
    "oversize ct": good(1, { locks: [lock({ ct: "C".repeat(16385) })] }),
    "a short salt (23, under 16 bytes in base64)": good(1, { locks: [lock({ salt: "S".repeat(23) })] }),
    "a long salt": good(1, { locks: [lock({ salt: "S".repeat(65) })] }),
    "a short iv": good(1, { locks: [lock({ iv: "I".repeat(15) })] }),
    "a lock that is not a map": good(1, { locks: ["x"] }),
  };
  for (const [name, d] of Object.entries(cases)) it(`refuses ${name}`, async () => { await assertFails(setDoc(vault(leader()), d)); });
  it("the shortest allowed salt (24: 16 bytes in base64) is fine", async () => { await assertSucceeds(setDoc(vault(leader()), good(1, { locks: [lock({ salt: "S".repeat(24) })] }))); });
  it("the largest allowed ct is fine", async () => { await assertSucceeds(setDoc(vault(leader()), good(1, { locks: [lock({ ct: "C".repeat(16384) })] }))); });
  it("refuses a bad shape on update too", async () => { await seed(1); await assertFails(setDoc(vault(leader()), good(2, { locks: [] }))); });
});

describe("everyone else is refused for everything", () => {
  const who = {
    "another uid with the same email": sameEmailOtherUid,
    "hiring's Leadership account": hiringAdmin,
    "voting's ED account": votingEd,
    "the pinned uid signed in anonymously": asAnonymous,
    "the pinned uid with a custom token": asCustom,
    "not signed in": signedOut,
  };
  for (const [name, db] of Object.entries(who)) {
    it(name, async () => {
      await assertFails(setDoc(vault(db()), good(1)));
      await seed(1);
      await assertFails(getDoc(vault(db())));
      await assertFails(setDoc(vault(db()), good(2)));
      await assertFails(getDocs(collection(db(), "vault")));
      await assertFails(deleteDoc(vault(db())));
    });
  }
});
