// vault-cli.mjs: the fixed interface set-passwords.py codes against. One JSON
// object on stdin, JSON on stdout, never a password or a decrypted value on
// stdout or stderr, exit 1 on any problem. Every value is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openVault } from "../../vault.js";

const CLI = fileURLToPath(new URL("../../vault-cli.mjs", import.meta.url));
const PW = "invented-cli-lead-1";
const ROLES = { leadership: PW, ed: "invented-cli-ed-2", guest: "invented-cli-guest-3" };
const SECRETS = [PW, ROLES.ed, ROLES.guest, "invented-cli-wrong-4", "invented-cli-next-5"];
const run = (args, input) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8" });
  for (const v of SECRETS) {
    assert.ok(!r.stdout.includes(v), "a value on stdout");
    assert.ok(!r.stderr.includes(v), "a value on stderr");
  }
  return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null, err: r.stderr };
};
const sealed = () => run(["seal"], { password: PW, content: { roles: ROLES, pending: null, changedAt: { leadership: "2026-10-17" } }, gen: 4 });

test("seal: one lock with a fresh salt, gen as given, content v and gen set and padded", async () => {
  const a = sealed(), b = sealed();
  assert.equal(a.code, 0, a.err);
  assert.deepEqual(Object.keys(a.out).sort(), ["gen", "locks", "v"]);
  assert.equal(a.out.v, 1);
  assert.equal(a.out.gen, 4);
  assert.equal(a.out.locks.length, 1);
  assert.deepEqual(Object.keys(a.out.locks[0]).sort(), ["ct", "iter", "iv", "salt"]);
  assert.equal(a.out.locks[0].iter, 600000);
  assert.notEqual(a.out.locks[0].salt, b.out.locks[0].salt);
  const o = await openVault(a.out, PW);
  assert.deepEqual(o.content, { v: 1, gen: 4, roles: ROLES, pending: null, changedAt: { leadership: "2026-10-17" } });
});

test("check: the round trip is ok; a wrong password or other roles are not, exit 1", () => {
  const { out: doc } = sealed();
  const ok = run(["check"], { password: PW, doc, expect: { roles: ROLES } });
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual(ok.out, { ok: true, opened: true, gen: 4, rolesMatch: true, pending: false });
  const wrong = run(["check"], { password: "invented-cli-wrong-4", doc, expect: { roles: ROLES } });
  assert.equal(wrong.code, 1);
  assert.deepEqual(wrong.out, { ok: false, opened: false, gen: 4, rolesMatch: false, pending: false });
  const other = run(["check"], { password: PW, doc, expect: { roles: { ...ROLES, guest: "invented-cli-next-5" } } });
  assert.equal(other.code, 1);
  assert.deepEqual(other.out, { ok: false, opened: true, gen: 4, rolesMatch: false, pending: false });
  const bad = run(["check"], { password: PW, doc: { ...doc, locks: [{ ...doc.locks[0], iter: 1000 }] }, expect: { roles: ROLES } });
  assert.equal(bad.code, 1);
  assert.equal(bad.out.opened, false);
});

test("check reports an unfinished page change", () => {
  const s = run(["seal"], { password: PW, content: { roles: ROLES, pending: { role: "ed", next: "invented-cli-next-5", done: [], inProgress: null, unsure: [] }, changedAt: {} }, gen: 2 });
  assert.equal(s.code, 0);
  const c = run(["check"], { password: PW, doc: s.out, expect: { roles: ROLES } });
  assert.equal(c.out.pending, true);
  assert.equal(c.code, 0);
});

test("any problem: exit 1 with a short fixed message, no value, nothing on stdout", () => {
  const cases = [
    [["seal"], `{"password":"${PW}", "content": `],                        // not JSON (cut off)
    [["seal"], "[1,2]"],
    [["seal"], { password: PW, content: { roles: { leadership: PW, ed: ROLES.ed } }, gen: 1 }],
    [["seal"], { password: PW, content: { roles: ROLES }, gen: 0 }],
    [["seal"], { password: "", content: { roles: ROLES }, gen: 1 }],
    [["check"], { password: PW, expect: { roles: ROLES } }],
    [["check"], { password: PW, doc: {}, expect: {} }],
    [["open"], { password: PW }],
    [[], { password: PW }],
    [["seal", PW], { password: PW, content: { roles: ROLES }, gen: 1 }],
  ];
  for (const [args, input] of cases) {
    const r = run(args, input);
    assert.equal(r.code, 1, JSON.stringify(args));
    assert.equal(r.out, null);
    assert.match(r.err, /^vault-cli: [\w ,.|:;()-]+\n$/);
    assert.ok(r.err.length < 120);
  }
});
