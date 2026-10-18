// Review round 1, the documentation items: the README says what a person
// needs (honest limits, iPhone, the way out of a stuck change, the fill-in
// list, the Guest check, how to install the test browsers); the workflow also
// runs when index.html changes; the test package says it is published.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const readme = readFileSync(new URL("README.md", root), "utf8").replace(/\s+/g, " ");
const has = (t) => assert.ok(readme.includes(t), `README lacks: ${t}`);

test("README: the honest limits, iPhone, a stuck change, PR B", () => {
  has("someone who knows only the old Leadership password can still read the saved copy for a while");
  has("for up to about an hour after");
  has("Choose a strong new Leadership password: three or four words.");
  has("iPhone Safari does not show that warning");
  has("Stuck with only Go on, and nobody knows the new Leadership password");
  has("set-passwords.py --apply");
  has("PR B also flips the test that checks `index.html` does not link this page");
});

test("README: setting it up lists every value to fill in, the Guest check, and the right commands", () => {
  for (const t of ["the `ADMIN_FIREBASE` values", "the uid on the `admin:leadership` line", "the same uid in place of `ADMIN_UID_NOT_SET`",
    "`role-accounts.json`", "remove \"(not created yet)\"", "bump every `?v=`",
    "at least 10 characters, has no word \"password\" in it, and no space at either end",
    "From `passwords/`: `tests/node_modules/.bin/firebase deploy --only firestore:rules --project mgh-ed-admin`",
    "npx playwright-core install chromium webkit"]) has(t);
  assert.ok(!readme.includes("passwords/tests/node_modules/.bin/firebase deploy"), "the old, wrong path");
});

test("the workflow also runs on index.html; the test package says it is published", () => {
  const wf = readFileSync(new URL(".github/workflows/passwords.yml", root), "utf8");
  assert.equal((wf.match(/^\s+- index\.html$/gm) || []).length, 2);
  const pkg = JSON.parse(readFileSync(new URL("passwords/tests/package.json", root), "utf8"));
  assert.match(pkg.description, /GitHub Pages publishes this folder too/);
});

test("README (round 2): PR A and the live checks come before the phone check; the salt size note", () => {
  has("Merge PR A (this page, not linked yet), then do the live checks of B.10 step 4");
  assert.ok(readme.indexOf("Merge PR A") < readme.indexOf("The maintainer's phone check"));
  assert.ok(readme.indexOf("Publish the rules") < readme.indexOf("Merge PR A"));
  has("The rules ask for a salt of at least 24 characters");
});

