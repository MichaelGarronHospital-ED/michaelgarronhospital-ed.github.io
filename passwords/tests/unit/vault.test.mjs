// vault.js (design B.3.4, B.8.1). Every value here is invented for the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KDF_ITER, makeLock, seal, openVault, openWithLocks, pad, additionalData, withoutNext, toB64, fromB64 } from "../../vault.js";

const OLD = "invented-lead-old-1";
const NEW = "invented-lead-new-2";
const content = (extra = {}) => ({
  roles: { leadership: OLD, ed: "invented-ed-value-3", guest: "invented-guest-value-4" },
  pending: null, changedAt: { leadership: null, ed: "2026-10-17T12:00:00.000Z", guest: null }, ...extra,
});
const docOf = (locks, gen) => ({ v: 1, gen, locks });
const flip = (b64) => { const b = fromB64(b64); b[0] ^= 1; return toB64(b); };

test("KDF rounds and the additional data are as designed", () => {
  assert.equal(KDF_ITER, 600000);
  assert.equal(additionalData(7), "mgh-ed-admin vault/main v1 gen 7");
});

test("round trip: seal then open gives the content back, with v and gen set and no pad", async () => {
  const lock = await makeLock(OLD);
  assert.equal(lock.iter, KDF_ITER);
  assert.equal(fromB64(lock.salt).length, 16);
  const locks = await seal(content(), [lock], 3);
  assert.equal(locks.length, 1);
  assert.deepEqual(Object.keys(locks[0]).sort(), ["ct", "iter", "iv", "salt"]);
  assert.equal(fromB64(locks[0].iv).length, 12);
  const r = await openVault(docOf(locks, 3), OLD);
  assert.ok(r);
  assert.equal(r.index, 0);
  assert.deepEqual(r.content, { v: 1, gen: 3, ...content() });
  assert.equal(r.lock.salt, lock.salt);
});

test("a wrong password returns null, with one lock and with two (no throw)", async () => {
  const one = await seal(content(), [await makeLock(OLD)], 1);
  assert.equal(await openVault(docOf(one, 1), "invented-wrong-5"), null);
  const two = await seal(content(), [await makeLock(OLD), await makeLock(NEW)], 1);
  assert.equal(await openVault(docOf(two, 1), "invented-wrong-5"), null);
});

test("hideNext strips only pending.next, in that lock only", async () => {
  const pending = { role: "leadership", next: NEW, startedAt: "2026-10-17T12:00:00.000Z", done: [], inProgress: null, unsure: [] };
  const oldLock = { ...(await makeLock(OLD)), hideNext: true }, newLock = await makeLock(NEW);
  const locks = await seal(content({ pending }), [oldLock, newLock], 4);
  const viaOld = await openVault(docOf(locks, 4), OLD);
  const viaNew = await openVault(docOf(locks, 4), NEW);
  assert.equal(viaOld.index, 0);
  assert.equal(viaNew.index, 1);
  const { next, ...rest } = pending;
  assert.deepEqual(viaOld.content.pending, rest);
  assert.deepEqual(viaNew.content.pending, pending);
  assert.deepEqual({ ...viaOld.content, pending: null }, { ...viaNew.content, pending: null });
  assert.ok(!JSON.stringify(viaOld.content).includes(NEW));
  assert.deepEqual(withoutNext({ pending: { a: 1 } }), { pending: { a: 1 } });
});

test("rotation: add a lock (both open), then drop the old one (old fails)", async () => {
  const oldLock = await makeLock(OLD), newLock = await makeLock(NEW);
  const both = await seal(content(), [oldLock, newLock], 5);
  assert.ok(await openVault(docOf(both, 5), OLD));
  assert.ok(await openVault(docOf(both, 5), NEW));
  const dropped = await seal(content(), [newLock], 6);
  assert.equal(await openVault(docOf(dropped, 6), OLD), null);
  assert.ok(await openVault(docOf(dropped, 6), NEW));
  assert.equal(dropped[0].salt, newLock.salt, "a lock keeps its salt while its password stays");
});

test("tampering with ct, iv or salt makes the lock not open", async () => {
  const locks = await seal(content(), [await makeLock(OLD)], 2);
  for (const field of ["ct", "iv", "salt"]) {
    const bad = [{ ...locks[0], [field]: flip(locks[0][field]) }];
    assert.equal(await openVault(docOf(bad, 2), OLD), null, field);
  }
});

test("content sealed for one gen does not open under another document gen", async () => {
  const locks = await seal(content(), [await makeLock(OLD)], 5);
  assert.equal(await openVault(docOf(locks, 6), OLD), null);
  assert.equal(await openVault(docOf(locks, 4), OLD), null);
  assert.ok(await openVault(docOf(locks, 5), OLD));
});

test("opening refuses iter below 600000, more than 2 locks, and a bad shape", async () => {
  const locks = await seal(content(), [await makeLock(OLD)], 1);
  await assert.rejects(() => openVault(docOf([{ ...locks[0], iter: 1000 }], 1), OLD), (e) => e.code === "vault-refused");
  await assert.rejects(() => openVault(docOf([locks[0], locks[0], locks[0]], 1), OLD), (e) => e.code === "vault-refused");
  await assert.rejects(() => openVault(docOf([], 1), OLD), (e) => e.code === "vault-refused");
  await assert.rejects(() => openVault({ v: 2, gen: 1, locks }, OLD), (e) => e.code === "vault-refused");
  await assert.rejects(() => openVault({ v: 1, gen: 0, locks }, OLD), (e) => e.code === "vault-refused");
  await assert.rejects(() => makeLock(OLD, { iter: 1000 }), (e) => e.code === "bad-iter");
  await assert.rejects(() => seal(content(), [], 1), (e) => e.code === "bad-locks");
  const l = await makeLock(OLD);
  await assert.rejects(() => seal(content(), [l, l, l], 1), (e) => e.code === "bad-locks");
});

test("errors never carry a value", async () => {
  try { await makeLock(OLD, { iter: 5 }); } catch (e) { assert.ok(!String(e.message).includes(OLD)); }
  try { await openVault({ v: 1, gen: 1, locks: [{ salt: "x", iter: 1, iv: "x", ct: "x" }] }, OLD); } catch (e) { assert.ok(!String(e.message + e.stack).includes(OLD)); }
});

test("1,000 seals never repeat an IV", async () => {
  const lock = await makeLock(OLD);
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add((await seal(content(), [lock], 1))[0].iv);
  assert.equal(seen.size, 1000);
});

test("salt is kept when given and renewed when not", async () => {
  const a = await makeLock(OLD);
  const b = await makeLock(OLD, { salt: a.salt, iter: a.iter });
  const c = await makeLock(OLD);
  assert.equal(b.salt, a.salt);
  assert.notEqual(c.salt, a.salt);
  // the same salt and password make a key that opens what the first sealed
  const locks = await seal(content(), [a], 1);
  assert.ok(await openWithLocks(docOf(locks, 1), [b]));
});

test("padding: multiples of 512 bytes, at least 1,024, and both locks of a change the same length", async () => {
  for (const n of [0, 10, 900, 1100, 3000]) {
    const t = pad(JSON.stringify({ x: "a".repeat(n) }));
    const len = new TextEncoder().encode(t).length;
    assert.equal(len % 512, 0, `n=${n}`);
    assert.ok(len >= 1024);
    assert.ok(JSON.parse(t).pad.trim() === "");
  }
  assert.equal(new TextEncoder().encode(pad("{}")).length, 1024);
  // non-ASCII values count in bytes
  assert.equal(new TextEncoder().encode(pad(JSON.stringify({ x: "é".repeat(600) }))).length % 512, 0);
  const pending = { role: "leadership", next: NEW + "x".repeat(400), done: [], inProgress: null, unsure: [] };
  const locks = await seal(content({ pending }), [{ ...(await makeLock(OLD)), hideNext: true }, await makeLock(NEW)], 1);
  assert.equal(locks[0].ct.length, locks[1].ct.length);
  // different roles of the same length give the same size too
  const s1 = await seal(content(), [await makeLock(OLD)], 1);
  const s2 = await seal(content({ roles: { leadership: "z", ed: "y", guest: "x" } }), [await makeLock(OLD)], 1);
  assert.equal(s1[0].ct.length, s2[0].ct.length);
});

test("openWithLocks opens with keys already made, and only matching salts", async () => {
  const a = await makeLock(OLD), b = await makeLock(NEW);
  const locks = await seal(content(), [a], 2);
  assert.ok(await openWithLocks(docOf(locks, 2), [b, a]));
  assert.equal(await openWithLocks(docOf(locks, 2), [b]), null);
  assert.equal(await openWithLocks(docOf(locks, 2), []), null);
});

test("no value is in the sealed document in clear", async () => {
  const pending = { role: "leadership", next: NEW, from: { "voting:ed": "invented-from-value-6" }, done: [], inProgress: null, unsure: [] };
  const locks = await seal(content({ pending }), [{ ...(await makeLock(OLD)), hideNext: true }, await makeLock(NEW)], 1);
  const raw = JSON.stringify(docOf(locks, 1));
  for (const v of [OLD, NEW, "invented-ed-value-3", "invented-guest-value-4", "invented-from-value-6"]) {
    assert.ok(!raw.includes(v));
    assert.ok(!raw.includes(Buffer.from(v).toString("base64").slice(0, 12)));
  }
});
