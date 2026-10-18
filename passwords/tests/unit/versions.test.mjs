// Versioned imports (design B.6.1): a browser gets a whole old set of the
// page's modules or a whole new set, never a mix. Every relative import in a
// page module carries ?v=<n>, and every ?v= in passwords/ (and passwords.html)
// is the same. vault-cli.mjs is a Node tool, not part of the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const dir = new URL("../../", import.meta.url);
const html = new URL("../passwords.html", dir);
const pageModules = readdirSync(dir).filter((n) => n.endsWith(".js"));
const imports = (src) => [...src.matchAll(/(?:import|export)\s[^"']*?from\s*["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)/g)].map((m) => m[1] || m[2]);

test("every relative import in a page module carries ?v=", () => {
  let n = 0;
  for (const f of pageModules) for (const spec of imports(readFileSync(new URL(f, dir), "utf8"))) { assert.match(spec, /\?v=\w+$/, `${f}: ${spec}`); n++; }
  assert.ok(n > 0);
});

test("every ?v= in passwords/ and passwords.html is the same", () => {
  const files = [...readdirSync(dir).filter((n) => /\.(js|mjs|css|html)$/.test(n)).map((n) => new URL(n, dir)), ...(existsSync(html) ? [html] : [])];
  const seen = new Map();
  for (const u of files) for (const m of readFileSync(u, "utf8").matchAll(/\?v=([\w.-]+)/g)) seen.set(m[1], u.pathname.split("/").pop());
  assert.ok(seen.size >= 1, "no ?v= found");
  assert.deepEqual([...seen.keys()], [[...seen.keys()][0]], `different versions: ${JSON.stringify([...seen])}`);
});
