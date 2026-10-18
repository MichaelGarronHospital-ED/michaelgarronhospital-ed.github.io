// Fakes for the unit tests: an auth adapter that enforces Firebase's
// "recent sign-in" rule on a fake clock (the Auth emulator does not), and an
// in-memory Firestore that acts like the rules (gen 1 on create, gen + 1 on
// update, 1 or 2 locks, updatedAt from the server). Every value is invented.
import { ACCOUNTS } from "../../core.js";

export const CUR = { leadership: "invented-lead-old-1", ed: "invented-ed-old-22", guest: "invented-guest-old-3" };
export const NEXT = { leadership: "invented-lead-new-4", ed: "invented-ed-new-55", guest: "invented-guest-new-6" };
export const all = (values = CUR) => Object.fromEntries(ACCOUNTS.map((a) => [a.key, values[a.role]]));
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const err = (code) => Object.assign(new Error(code), { code });

// passwords: { <key>: value } what each account accepts now (changed in place)
export function fakeAuth({ passwords, clock = { now: 0 }, failUpdateOn = null, loseAnswerOn = null, once = true,
  refuse = new Set(), throttleOn = null, disabled = new Set(), ruleRefuses = null } = {}) {
  const log = [];
  let mainLastAuth = clock.now;          // the gate sign-in
  const f = {
    log, passwords, clock,
    set failUpdateOn(k) { failUpdateOn = k; },
    set throttleOn(k) { throttleOn = k; },
    disabled,
    async open(a, pw) {
      log.push(`open ${a.key}`);
      if (throttleOn === a.key) throw err("auth/too-many-requests");
      if (disabled.has(a.key)) throw err("auth/user-disabled");
      if (refuse.has(a.key) || passwords[a.key] !== pw) throw err("auth/invalid-credential");
      if (a.main) mainLastAuth = clock.now;
      return { key: a.key, at: clock.now, main: !!a.main };
    },
    async update(s, v) {
      // Firebase: updatePassword needs a sign-in less than about 5 minutes old
      const at = s.main ? mainLastAuth : s.at;
      if (clock.now - at > 5 * 60000) throw err("auth/requires-recent-login");
      if (ruleRefuses === s.key) throw err("auth/password-does-not-meet-requirements");
      if (failUpdateOn === s.key) { if (once) failUpdateOn = null; throw err("auth/network-request-failed"); }
      if (loseAnswerOn === s.key) { if (once) loseAnswerOn = null; passwords[s.key] = v; log.push(`update ${s.key}`); throw err("auth/network-request-failed"); }
      log.push(`update ${s.key}`); passwords[s.key] = v;
    },
    async close() {},
  };
  return f;
}

// An in-memory Firestore with the parts store.js uses. mem.raw: every
// document written, as text (for the leak test). mem.beforeTx: a hook that
// runs before each transaction (another device writing). mem.failWrite(n):
// the n-th next write fails with a network error.
export function memFirestore() {
  const mem = { data: null, raw: [], reads: 0, writes: 0, beforeTx: null, failIn: 0 };
  const snap = (d) => ({ exists: () => !!d, data: () => clone(d) });
  mem.failWrite = (n) => { mem.failIn = n; };
  mem.fs = {
    doc: (db, c, id) => ({ path: `${c}/${id}` }),
    getDoc: async (ref) => { mem.reads++; return snap(ref.path === "vault/main" ? mem.data : null); },
    serverTimestamp: () => ({ server: true }),
    runTransaction: async (db, fn) => {
      if (mem.beforeTx) { const h = mem.beforeTx; mem.beforeTx = null; await h(); }
      let set = null;
      const tx = { get: async () => { mem.reads++; return snap(mem.data); }, set: (ref, v) => { set = v; } };
      const result = await fn(tx);
      if (set) {
        if (mem.failIn && --mem.failIn === 0) throw err("unavailable");
        // the rules, roughly
        const okGen = mem.data ? set.gen === mem.data.gen + 1 : set.gen === 1;
        const okShape = set.v === 1 && Array.isArray(set.locks) && set.locks.length >= 1 && set.locks.length <= 2
          && set.updatedAt && set.updatedAt.server && Object.keys(set).sort().join() === "gen,locks,updatedAt,v"
          && set.locks.every((l) => Object.keys(l).sort().join() === "ct,iter,iv,salt" && l.iter >= 600000);
        if (!okGen || !okShape) throw err("permission-denied");
        mem.data = clone(set); mem.writes++; mem.raw.push(JSON.stringify(set));
      }
      return result;
    },
  };
  mem.db = {};
  return mem;
}
