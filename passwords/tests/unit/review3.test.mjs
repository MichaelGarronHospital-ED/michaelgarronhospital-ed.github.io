// Review round 3: after a reload caused by another device, the tab forgets the
// "tools disagree" values of every role that moved. Every value is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { firstUse, openSession, changePassword, makeGuard, movedRoles } from "../../core.js";
import { makeStore } from "../../store.js";
import { CUR, NEXT, all, fakeAuth, memFirestore } from "./fakes.mjs";

const now = () => "2026-10-18T12:00:00.000Z";
const base = { roles: { ...CUR }, pending: null, changedAt: { leadership: null, ed: null, guest: null } };
const with_ = (x) => ({ ...base, ...x, roles: { ...base.roles, ...(x.roles || {}) }, changedAt: { ...base.changedAt, ...(x.changedAt || {}) } });

test("movedRoles: a saved value or date that moved, a change started, finished or cancelled elsewhere", () => {
  assert.deepEqual(movedRoles(base, with_({})), []);
  assert.deepEqual(movedRoles(base, with_({ roles: { ed: NEXT.ed }, changedAt: { ed: now() } })), ["ed"]);
  assert.deepEqual(movedRoles(base, with_({ changedAt: { guest: now() } })), ["guest"]);
  assert.deepEqual(movedRoles(base, with_({ pending: { role: "leadership", done: [] } })), ["leadership"]);           // started elsewhere
  assert.deepEqual(movedRoles(with_({ pending: { role: "ed", done: [] } }), base), ["ed"]);                           // cancelled elsewhere
  assert.deepEqual(movedRoles(null, base), ["leadership", "ed", "guest"]);
});

test("round 3 case C: another device finishes ED; this tab's Leadership change says changed elsewhere, forgets ED's old value, then saves", async () => {
  const LX = "invented-hiring-lead-x1", EX = "invented-hiring-ed-x2";
  const mem = memFirestore(); const store = makeStore(mem.fs, mem.db);
  const passwords = all(); passwords["hiring:admin"] = LX; passwords["hiring:committee"] = EX;
  const auth = fakeAuth({ passwords }); const guard = makeGuard();
  const ctx0 = { auth, store, guard, mainValue: CUR.leadership };
  const r1 = await firstUse(ctx0, { ed: CUR.ed, guest: CUR.guest });
  const r2 = await firstUse(ctx0, { ed: CUR.ed, guest: CUR.guest }, { overrides: { "hiring:admin": LX, "hiring:committee": EX }, proven: r1.proven });
  // this tab, as app.js keeps it
  const diffFrom = { ...r2.differ };
  const known = () => Object.assign({}, ...Object.values(diffFrom));
  const a = { auth, session: r2.session, guard, now };
  // another device finishes the ED change
  const other = (await openSession({ store, password: CUR.leadership })).session;
  const rb = await changePassword({ auth, session: other, guard: makeGuard(), now }, "ed", NEXT.ed, { from: r2.differ.ed, known: { ...r2.differ.ed, ...r2.differ.leadership } });
  assert.equal(rb.ok, true);
  await assert.rejects(() => changePassword(a, "leadership", NEXT.leadership, { from: diffFrom.leadership, known: known() }), (e) => e.code === "changed-elsewhere");
  // what elsewhere() does
  const before = JSON.parse(JSON.stringify(a.session.content));
  await a.session.reload();
  const moved = movedRoles(before, a.session.content).filter((r) => diffFrom[r]);
  assert.deepEqual(moved, ["ed"]);
  for (const r of moved) delete diffFrom[r];
  const res = await changePassword(a, "leadership", NEXT.leadership, { from: diffFrom.leadership, known: known() });
  assert.equal(res.ok, true, res.stage);
  for (const k of ["admin:leadership", "voting:leadership", "hiring:admin"]) assert.equal(passwords[k], NEXT.leadership);
});
