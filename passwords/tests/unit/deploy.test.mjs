// Round 1 D-M1: filling in the real values (ADMIN_FIREBASE, the admin uid in
// config.js and in firestore.rules) must not break the tests. The test build's
// edits work by pattern; here they run on the repo's files and on a simulated
// filled-in copy (invented values that look like real ones).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testConfig, testRules, blankAdminUid, TEST_UID, PROJECT } from "../make-site.mjs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const cfg = read("../../config.js"), rules = read("../../firestore.rules");
const INVENTED_UID = "InventedAdminUid0000000001";
const deployedCfg = cfg
  .replace(/(ADMIN_FIREBASE = \{[^}]*)apiKey: "[^"]*"/, '$1apiKey: "AIzaInventedKeyForTheTestsOnly000000000"')
  .replace(/(ADMIN_FIREBASE = \{[^}]*)appId: "[^"]*"/, '$1appId: "1:000000000000:web:inventedtest"')
  .replace(/(\{ key: "admin:leadership",[^\n]*uid: )""/, `$1"${INVENTED_UID}"`);
const deployedRules = rules.replace(/request\.auth\.uid == '[^']*'/, `request.auth.uid == '${INVENTED_UID}'`);
const load = async (text) => import("data:text/javascript;base64," + Buffer.from(text).toString("base64"));

test("the simulated filled-in copy really differs from the repo's", () => {
  assert.notEqual(deployedCfg, cfg);
  assert.ok(deployedCfg.includes(INVENTED_UID) && deployedRules.includes(INVENTED_UID));
});

for (const [name, c, r] of [["the repo's files", cfg, rules], ["a filled-in copy", deployedCfg, deployedRules]]) {
  test(`test build from ${name}: demo project, invented keys, the test uid in config and rules`, async () => {
    const m = await load(testConfig(c));
    assert.equal(m.ADMIN_FIREBASE.apiKey, "demo-admin-key");
    for (const k of ["ADMIN_FIREBASE", "HIRING_FIREBASE", "VOTING_FIREBASE"]) assert.equal(m[k].projectId, PROJECT);
    assert.ok(!/AIza/.test(testConfig(c)));
    assert.equal(m.ACCOUNTS.find((a) => a.key === "admin:leadership").uid, TEST_UID);
    assert.equal(m.ACCOUNTS.filter((a) => a.uid === TEST_UID).length, 1);
    assert.ok(testRules(r).includes(`request.auth.uid == '${TEST_UID}'`));
    assert.ok(!testRules(r).includes(INVENTED_UID) && !testRules(r).includes("ADMIN_UID_NOT_SET"));
  });
  test(`the not-set-up copy from ${name} has no admin uid`, async () => {
    const m = await load(blankAdminUid(c));
    assert.equal(m.ACCOUNTS.find((a) => a.key === "admin:leadership").uid, "");
    assert.equal(m.ACCOUNTS.filter((a) => a.uid).length, 5);
  });
}
