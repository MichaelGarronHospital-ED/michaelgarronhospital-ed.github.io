// All text plain, no em dashes anywhere in passwords/ and passwords.html
// (code comments included).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../../", import.meta.url));
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    if (n === "node_modules" || n.startsWith("site")) continue;
    const p = d + n;
    if (statSync(p).isDirectory()) walk(p + "/");
    else if (/\.(js|mjs|css|html|json|rules|md)$|^\.firebaserc$/.test(n)) files.push(p);
  }
})(dir);
const html = fileURLToPath(new URL("../passwords.html", "file://" + dir));
if (existsSync(html)) files.push(html);

test("no em dash in passwords/ or passwords.html", () => {
  assert.ok(files.length > 10);
  const EM = String.fromCharCode(0x2014);
  const bad = files.filter((f) => readFileSync(f, "utf8").includes(EM)).map((f) => f.slice(dir.length));
  assert.deepEqual(bad, []);
});
