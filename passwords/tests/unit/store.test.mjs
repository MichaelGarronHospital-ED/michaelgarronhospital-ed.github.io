// store.js with an in-memory Firestore (the emulator test in rules/ runs the
// same against the real rules).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStore, firestoreLite, SDK_BASE } from "../../store.js";
import { memFirestore } from "./fakes.mjs";

const lock = { salt: "A".repeat(24), iter: 600000, iv: "B".repeat(16), ct: "C".repeat(40) };

test("read gives null when there is no vault, then the document without the server time", async () => {
  const mem = memFirestore();
  const store = makeStore(mem.fs, mem.db);
  assert.equal(await store.read(), null);
  const doc = await store.write(0, async (live) => { assert.equal(live, null); return { v: 1, gen: 1, locks: [lock] }; });
  assert.deepEqual(doc, { v: 1, gen: 1, locks: [lock] });
  assert.deepEqual(mem.data.updatedAt, { server: true }, "updatedAt is the server's time");
  assert.deepEqual(await store.read(), { v: 1, gen: 1, locks: [lock] });
});

test("a write checks gen: changed-elsewhere when another device wrote, before build runs", async () => {
  const mem = memFirestore();
  const store = makeStore(mem.fs, mem.db);
  await store.write(0, async () => ({ v: 1, gen: 1, locks: [lock] }));
  let built = 0;
  await assert.rejects(() => store.write(0, async () => { built++; return { v: 1, gen: 1, locks: [lock] }; }),
    (e) => e.code === "changed-elsewhere" && e.message === "This was just changed on another device. Here is the latest.");
  // another device writes between this tab's read and its write
  mem.beforeTx = async () => { await store.write(1, async () => ({ v: 1, gen: 2, locks: [lock] })); };
  await assert.rejects(() => store.write(1, async () => { built++; return { v: 1, gen: 2, locks: [lock] }; }), (e) => e.code === "changed-elsewhere");
  assert.equal(built, 0);
  assert.equal(mem.data.gen, 2);
});

test("a write that is not gen + 1 or not version 1 is refused by the store itself", async () => {
  const mem = memFirestore();
  const store = makeStore(mem.fs, mem.db);
  await assert.rejects(() => store.write(0, async () => ({ v: 1, gen: 2, locks: [lock] })), (e) => e.code === "bad-write");
  await assert.rejects(() => store.write(0, async () => ({ v: 2, gen: 1, locks: [lock] })), (e) => e.code === "bad-write");
  assert.equal(mem.data, null);
});

test("the page loads firestore-lite 12.19.0 from gstatic", async () => {
  const asked = [];
  const f = { getFirestore: (app) => ({ app }), doc() {}, getDoc() {}, runTransaction() {}, serverTimestamp() {} };
  const r = await firestoreLite("APP", { importer: async (u) => { asked.push(u); return f; } });
  assert.deepEqual(asked, ["https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore-lite.js"]);
  assert.equal(SDK_BASE, "https://www.gstatic.com/firebasejs/12.19.0/");
  assert.deepEqual(r.db, { app: "APP" });
  assert.deepEqual(Object.keys(r.fs).sort(), ["doc", "getDoc", "runTransaction", "serverTimestamp"]);
});
