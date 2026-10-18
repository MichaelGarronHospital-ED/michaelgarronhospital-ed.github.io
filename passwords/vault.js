// ============================================================================
//  The vault: the encrypted copy of the three ED tools passwords (design B.3).
//
//  One Firestore document, vault/main:
//    { v: 1, gen, updatedAt, locks: [ { salt, iter, iv, ct } ] }
//  Each lock holds the whole content, encrypted with a key made from one
//  Leadership password. One lock normally; two only during a Leadership
//  change (the old value and the new one). The lock for the OLD value never
//  holds pending.next (hideNext), so the old password can't show the new one.
//
//  Key: PBKDF2-SHA-256, 600,000 rounds, 16 random bytes of salt per lock, the
//  exact typed string (UTF-8). AES-GCM 256, non-extractable. A fresh random
//  12-byte IV on every write, 128-bit tag, additional data naming the document
//  number (gen), so a lock from one write can't be paired with a newer number.
//  Every copy is padded to the same length (next 512 bytes, at least 1,024).
//
//  Works in browsers and in Node 20+ (globalThis.crypto). No imports.
//  Nothing here logs, and no error message carries a value.
// ============================================================================

export const KDF_ITER = 600000;
export const MAX_ITER = 10000000;     // the rules' upper limit too
export const MAX_LOCKS = 2;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const PAD_STEP = 512;
const PAD_MIN = 1024;

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const additionalData = (gen) => `mgh-ed-admin vault/main v1 gen ${gen}`;

// a short fixed message and a code; never a value
function vaultError(code) {
  const e = new Error(`vault: ${code}`);
  e.code = code;
  return e;
}

// ---- base64 -----------------------------------------------------------------
export function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(text) {
  const s = atob(String(text));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const byteLen = (text) => enc.encode(text).length;

// ---- keys -------------------------------------------------------------------
// -> { key, salt, iter }. A new lock (fresh salt) unless salt is given (the
// salt stays while its password stays). Callers add hideNext: true to the
// OLD lock during a Leadership change.
export async function makeLock(password, { salt, iter } = {}) {
  const rounds = iter === undefined ? KDF_ITER : iter;
  if (!Number.isInteger(rounds) || rounds < KDF_ITER || rounds > MAX_ITER) throw vaultError("bad-iter");
  if (typeof password !== "string" || !password) throw vaultError("bad-password");
  const saltBytes = salt === undefined ? randomBytes(SALT_BYTES) : fromB64(salt);
  if (saltBytes.length < SALT_BYTES) throw vaultError("bad-salt");
  const base = await subtle().importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await subtle().deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: rounds },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return { key, salt: salt === undefined ? toB64(saltBytes) : salt, iter: rounds };
}

// ---- padding ----------------------------------------------------------------
// json: the content as a JSON object text. Adds a "pad" field of spaces so the
// UTF-8 length is a multiple of 512 bytes, at least 1,024 (or atLeast).
export function pad(json, atLeast = 0) {
  const text = String(json);
  if (!text.startsWith("{") || !text.endsWith("}")) throw vaultError("bad-content");
  const empty = text === "{}";
  const overhead = byteLen(empty ? '"pad":""' : ',"pad":""');
  const len = byteLen(text) + overhead;
  const target = Math.max(PAD_MIN, atLeast, Math.ceil(len / PAD_STEP) * PAD_STEP);
  return text.slice(0, -1) + (empty ? "" : ",") + '"pad":"' + " ".repeat(target - len) + '"}';
}

// the content without pending.next (the OLD lock of a Leadership change)
export function withoutNext(content) {
  if (!content || !content.pending || !("next" in content.pending)) return content;
  const { next, ...rest } = content.pending;
  return { ...content, pending: rest };
}

// ---- seal ---------------------------------------------------------------------
// content: { roles, pending, changedAt } (v and gen are set here, pad added).
// locks: 1 or 2 from makeLock (in document order). -> [{ salt, iter, iv, ct }]
export async function seal(content, locks, gen) {
  if (!Number.isInteger(gen) || gen < 1) throw vaultError("bad-gen");
  if (!Array.isArray(locks) || locks.length < 1 || locks.length > MAX_LOCKS) throw vaultError("bad-locks");
  if (!content || typeof content !== "object") throw vaultError("bad-content");
  const { v, gen: g, pad: p, ...rest } = content;
  const base = { v: 1, gen, ...rest };
  const texts = locks.map((l) => JSON.stringify(l.hideNext ? withoutNext(base) : base));
  // every copy the same length, so the two locks of a change look alike
  const size = Math.max(...texts.map((t) => byteLen(pad(t))));
  const out = [];
  for (let i = 0; i < locks.length; i++) {
    const l = locks[i];
    if (!l || !l.key || !l.salt || !l.iter) throw vaultError("bad-locks");
    const iv = randomBytes(IV_BYTES);
    const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(additionalData(gen)), tagLength: 128 },
      l.key, enc.encode(pad(texts[i], size)));
    out.push({ salt: l.salt, iter: l.iter, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) });
  }
  return out;
}

// ---- open ---------------------------------------------------------------------
// A document this page would never write is refused before any key is made.
function checkDoc(doc) {
  if (!doc || doc.v !== 1 || !Number.isInteger(doc.gen) || doc.gen < 1) throw vaultError("vault-refused");
  if (!Array.isArray(doc.locks) || doc.locks.length < 1 || doc.locks.length > MAX_LOCKS) throw vaultError("vault-refused");
  for (const l of doc.locks) {
    if (!l || typeof l.salt !== "string" || typeof l.iv !== "string" || typeof l.ct !== "string") throw vaultError("vault-refused");
    if (!Number.isInteger(l.iter) || l.iter < KDF_ITER || l.iter > MAX_ITER) throw vaultError("vault-refused");
  }
}

async function tryLock(doc, l, key) {
  let plain;
  try {
    plain = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(l.iv), additionalData: enc.encode(additionalData(doc.gen)), tagLength: 128 },
      key, fromB64(l.ct));
  } catch { return null; }
  let c;
  try { c = JSON.parse(dec.decode(plain)); } catch { return null; }
  if (!c || c.v !== 1 || c.gen !== doc.gen) return null;
  delete c.pad;
  return c;
}

// -> { content, lock, index } | null. A wrong password is null (no throw);
// a document with iter < 600000, more than 2 locks or a bad shape throws
// { code: "vault-refused" }.
export async function openVault(doc, password) {
  checkDoc(doc);
  for (let i = 0; i < doc.locks.length; i++) {
    const l = doc.locks[i];
    const lock = await makeLock(password, { salt: l.salt, iter: l.iter });
    const content = await tryLock(doc, l, lock.key);
    if (content) return { content, lock, index: i };
  }
  return null;
}

// Open a newer copy with keys this tab already made (after "changed
// elsewhere"): no PBKDF2, no password. -> { content, lock, index } | null
export async function openWithLocks(doc, locks) {
  checkDoc(doc);
  for (let i = 0; i < doc.locks.length; i++) {
    const l = doc.locks[i];
    const known = (locks || []).find((k) => k && k.salt === l.salt && k.iter === l.iter);
    if (!known) continue;
    const content = await tryLock(doc, l, known.key);
    if (content) return { content, lock: known, index: i };
  }
  return null;
}
