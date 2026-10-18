// An account is known by its uid (design B.4, Phase A). The admin uid in
// config.js equals the one in firestore.rules (both "not set yet" counts as
// equal); the five tool accounts equal the workspace's role-accounts.json when
// it is there (it is outside this repo). And ADMIN_FIREBASE stays where the
// workspace scripts read it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { ACCOUNTS, ADMIN_FIREBASE } from "../../config.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const rules = read("../../firestore.rules");
const PLACEHOLDER = "ADMIN_UID_NOT_SET";

test("the admin uid in config.js equals the one in firestore.rules", () => {
  const inRules = [...rules.matchAll(/request\.auth\.uid == '([^']*)'/g)].map((m) => m[1]);
  assert.equal(inRules.length, 1);
  const admin = ACCOUNTS.find((a) => a.key === "admin:leadership").uid;
  if (!admin) assert.equal(inRules[0], PLACEHOLDER, "config.js has no admin uid, but the rules have one");
  else assert.equal(inRules[0], admin);
});

test("every other account has a uid, and the six emails are the Phase A .invalid ones", () => {
  for (const a of ACCOUNTS) if (a.key !== "admin:leadership") assert.match(a.uid, /^[A-Za-z0-9]{20,40}$/, a.key);
  assert.equal(new Set(ACCOUNTS.map((a) => a.uid)).size, ACCOUNTS.length);
  for (const a of ACCOUNTS) assert.match(a.email, /@mgh-ed-(admin|hiring|voting)\.invalid$/);
});

const ws = new URL("../../../../role-accounts.json", import.meta.url);
test("the five tool accounts equal the workspace's role-accounts.json", { skip: !existsSync(ws) && "role-accounts.json is not next to the repo" }, () => {
  const list = JSON.parse(readFileSync(ws, "utf8")).accounts;
  assert.equal(list.length, 5);
  for (const r of list) {
    const a = ACCOUNTS.find((x) => x.key === r.key);
    assert.ok(a, r.key);
    assert.equal(a.uid, r.uid, r.key);
    assert.equal(a.email, r.new, r.key);
    assert.equal(a.role, r.role, r.key);
  }
});

test("ADMIN_FIREBASE is the first object in config.js, found by the workspace pattern", () => {
  const src = read("../../config.js");
  const m = src.match(/ADMIN_FIREBASE\s*=\s*\{[^}]*apiKey:\s*"([^"]+)"/);
  assert.ok(m);
  assert.equal(m[1], ADMIN_FIREBASE.apiKey);
  assert.equal(src.indexOf("{"), src.indexOf("ADMIN_FIREBASE = {") + "ADMIN_FIREBASE = ".length);
  for (const name of ["ADMIN_FIREBASE", "HIRING_FIREBASE", "VOTING_FIREBASE"]) {
    const body = src.match(new RegExp(`${name}\\s*=\\s*\\{([^}]*)\\}`))[1];
    assert.ok(!body.includes("{"), `${name} has a nested object`);
  }
  assert.equal(ADMIN_FIREBASE.projectId, "mgh-ed-admin");
});

// round 1 D-M1: once the admin account exists, the workspace file lists it too
test("the admin uid equals role-accounts.json's admin uid, when that file has one", { skip: !existsSync(ws) && "role-accounts.json is not next to the repo" }, (t) => {
  const j = JSON.parse(readFileSync(ws, "utf8"));
  const entry = (j.accounts || []).find((a) => a.key === "admin:leadership" || a.key === "admin") || j.admin || null;
  if (!entry || !entry.uid) { t.skip("role-accounts.json has no admin uid yet"); return; }
  assert.equal(ACCOUNTS.find((a) => a.key === "admin:leadership").uid, entry.uid);
});

