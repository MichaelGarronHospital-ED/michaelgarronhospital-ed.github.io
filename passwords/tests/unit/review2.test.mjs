// Review round 2: one test (or more) for each fix in core.js. Every value is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { firstUse, changePassword, makeGuard, validateChange, neitherText, failureText, TEXT, checkFirst } from "../../core.js";
import { makeStore } from "../../store.js";
import { CUR, NEXT, all, fakeAuth, memFirestore } from "./fakes.mjs";

const now = () => "2026-10-18T12:00:00.000Z";
const LX = "invented-hiring-lead-x1", EX = "invented-hiring-ed-x2";

// the reviewers' case: hiring:admin and hiring:committee both differ from the other tools
async function twoDiffer() {
  const mem = memFirestore(); const store = makeStore(mem.fs, mem.db);
  const passwords = all(); passwords["hiring:admin"] = LX; passwords["hiring:committee"] = EX;
  const auth = fakeAuth({ passwords }); const guard = makeGuard();
  const ctx0 = { auth, store, guard, mainValue: CUR.leadership };
  const r1 = await firstUse(ctx0, { ed: CUR.ed, guest: CUR.guest });
  const r2 = await firstUse(ctx0, { ed: CUR.ed, guest: CUR.guest }, { overrides: { "hiring:admin": LX, "hiring:committee": EX }, proven: r1.proven });
  assert.equal(r2.outcome, "saved");
  assert.deepEqual(Object.keys(r2.differ).sort(), ["ed", "leadership"]);
  return { passwords, ctx: { auth, session: r2.session, guard, now }, differ: r2.differ };
}

test("N-M1: two roles whose hiring accounts both differ: each change passes Check with the values this tab knows", async () => {
  const { passwords, ctx, differ } = await twoDiffer();
  const diffFrom = { ...differ };
  const known = () => Object.assign({}, ...Object.values(diffFrom));
  for (const role of ["leadership", "ed", "guest"]) {
    const res = await changePassword(ctx, role, NEXT[role], { from: diffFrom[role] || {}, known: known() });
    assert.equal(res.ok, true, `${role}: ${res.stage} ${res.results ? JSON.stringify(res.results.at(-1)) : ""}`);
    delete diffFrom[role];
  }
  for (const [k, v] of Object.entries(passwords)) assert.equal(v, NEXT[k === "hiring:admin" || k.endsWith("leadership") ? "leadership" : k === "hiring:applicant" ? "guest" : "ed"], k);
  assert.deepEqual(ctx.session.content.roles, NEXT);
});

test("N-M1: without those values Check stops at the other role's hiring account (why they are passed)", async () => {
  const { ctx, differ } = await twoDiffer();
  const r = await checkFirst(ctx, "leadership", differ.leadership);
  assert.equal(r.ok, false);
  assert.equal(r.results.at(-1).key, "hiring:committee");
  const ok = await checkFirst(ctx, "leadership", differ.leadership, { ...differ.leadership, ...differ.ed });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.results.map((x) => x.key), ["admin:leadership", "voting:leadership", "hiring:admin", "hiring:committee", "hiring:applicant"]);
});

test("m1: the Finish-line text offers typing only when the page can (before Go on it says to press Go on)", () => {
  assert.equal(neitherText("hiring:committee", true), failureText({ code: "refused" }, "hiring:committee"));
  assert.equal(neitherText("voting:leadership", false), "Motion Voting's Admin account doesn't accept the saved password or the new one. Someone may have changed it another way. Press Go on first.");
});

test("m4: a value typed earlier on this page has its own words", () => {
  const content = { roles: CUR, pending: null };
  assert.deepEqual(validateChange(content, "guest", NEXT.guest, NEXT.guest, {}, [NEXT.guest]), ["You typed this earlier on this page. Choose a different new password."]);
  assert.equal(TEXT.typedEarlier, "You typed this earlier on this page. Choose a different new password.");
  // a value in use now keeps the in-use words, not both
  assert.equal(validateChange(content, "guest", CUR.ed, CUR.ed, {}, [CUR.ed]).length, 1);
});
