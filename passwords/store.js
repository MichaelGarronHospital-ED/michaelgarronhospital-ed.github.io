// ============================================================================
//  The vault document in Firestore (project mgh-ed-admin, vault/main).
//
//  read():  one read of vault/main (once per sign-in) -> the document or null.
//  write(expectGen, build): a Firestore transaction. It reads vault/main and
//    checks its gen is the one this tab last saw (0 when there is none yet);
//    if another device wrote meanwhile it stops with code "changed-elsewhere"
//    before anything is written. Then build(liveDoc) makes the new document
//    ({ v: 1, gen: expectGen + 1, locks }, already sealed) and it is written
//    with updatedAt set to the server time (the rules require both).
//
//  The page passes the Firestore lite SDK (firestoreLite below); the tests pass
//  a fake or the npm package pointed at the emulator. Nothing here sees a
//  password: everything in the document is already encrypted.
// ============================================================================

export const SDK_BASE = "https://www.gstatic.com/firebasejs/10.12.2/";
export const VAULT_COLLECTION = "vault";
export const VAULT_ID = "main";

const fail = (code, message) => Object.assign(new Error(message), { code });

// The lite SDK for the page (no live listeners, no offline cache).
// importer is injectable for tests.
export async function firestoreLite(app, { importer = (u) => import(u) } = {}) {
  const f = await importer(SDK_BASE + "firebase-firestore-lite.js");
  return {
    db: f.getFirestore(app),
    fs: { doc: f.doc, getDoc: f.getDoc, runTransaction: f.runTransaction, serverTimestamp: f.serverTimestamp },
  };
}

// only the fields this page wrote (updatedAt is the server's)
const plain = (d) => (d ? { v: d.v, gen: d.gen, locks: Array.isArray(d.locks) ? d.locks.map((l) => ({ ...l })) : d.locks } : null);

// fs: { doc, getDoc, runTransaction, serverTimestamp }; db: a Firestore instance
export function makeStore(fs, db) {
  const ref = () => fs.doc(db, VAULT_COLLECTION, VAULT_ID);
  return {
    async read() {
      const snap = await fs.getDoc(ref());
      return snap.exists() ? plain(snap.data()) : null;
    },
    async write(expectGen, build) {
      return fs.runTransaction(db, async (tx) => {
        const r = ref();
        const snap = await tx.get(r);
        const live = snap.exists() ? plain(snap.data()) : null;
        const gen = live ? live.gen : 0;
        if (gen !== expectGen) throw fail("changed-elsewhere", "This was just changed on another device. Here is the latest.");
        const next = await build(live);
        if (!next || next.v !== 1 || next.gen !== expectGen + 1 || !Array.isArray(next.locks)) throw fail("bad-write", "Couldn't save. Please try again.");
        tx.set(r, { v: 1, gen: next.gen, updatedAt: fs.serverTimestamp(), locks: next.locks });
        return { v: 1, gen: next.gen, locks: next.locks };
      });
    },
  };
}
