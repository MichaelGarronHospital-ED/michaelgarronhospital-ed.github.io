// Ported from hiring's tests/repo-hygiene.test.mjs (design B.6.1, review m5).
// GitHub Pages publishes everything tracked in this repo, so nothing generated
// may ever be tracked: no node_modules, no built test site (passwords/tests/
// site*/), no log, and no file carrying the test-build marker that
// make-site.mjs puts in every copy it points at the emulators.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
// written in two parts so this file does not carry it
export const TEST_BUILD_MARKER = "PASSWORDS-TEST-" + "BUILD-ONLY";
let tracked = null;
try { tracked = execSync("git ls-files", { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean); } catch { /* not a git checkout */ }

test("no node_modules, built test site, log or debug file is tracked", { skip: tracked === null && "not a git checkout" }, () => {
  const bad = tracked.filter((f) => /(^|\/)node_modules\//.test(f) || /^passwords\/tests\/site[^/]*\//.test(f)
    || /(^|\/)firestore-debug\.log$|\.log$/.test(f));
  assert.deepEqual(bad, []);
});

test("no tracked file carries the test-build marker", { skip: tracked === null && "not a git checkout" }, () => {
  const bad = tracked.filter((f) => /\.(html|js|mjs|css|json|rules)$/.test(f)).filter((f) => {
    try { return readFileSync(root + f, "utf8").includes(TEST_BUILD_MARKER); } catch { return false; }
  });
  assert.deepEqual(bad, []);
});

test("the ignore rules cover the test tools and builds", () => {
  const gi = readFileSync(root + ".gitignore", "utf8");
  for (const line of ["passwords/tests/node_modules/", "passwords/tests/site*/", "*.log", "firestore-debug.log"]) assert.ok(gi.split("\n").includes(line), line);
});
