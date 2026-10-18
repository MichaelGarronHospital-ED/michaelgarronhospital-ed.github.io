// The page's own rules (design B.6.1): the content policy exactly as designed,
// no inline script or style anywhere (the policy would block it), the shared
// look loaded first and unchanged, and nothing that links to the page yet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const html = readFileSync(new URL("passwords.html", root), "utf8");
const POLICY = "default-src 'none'; script-src 'self' https://www.gstatic.com/firebasejs/10.12.2/; style-src 'self'; img-src 'self'; connect-src https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://www.googleapis.com; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

test("the content policy is B.6.1's, as a meta tag", () => {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(m);
  assert.equal(m[1].replace(/\s+/g, " "), POLICY);
});

test("no inline script, no inline style, no inline handler", () => {
  assert.ok(![...html.matchAll(/<script\b([^>]*)>/g)].some((m) => !/\bsrc=/.test(m[1])), "an inline script");
  assert.ok(!/<style\b/i.test(html), "a style element");
  assert.ok(!/\sstyle=/i.test(html), "a style attribute");
  assert.ok(!/\son[a-z]+=/i.test(html), "an inline handler");
  for (const f of readdirSync(new URL("passwords/", root)).filter((n) => n.endsWith(".js"))) {
    const src = readFileSync(new URL(`passwords/${f}`, root), "utf8");
    assert.ok(!/\sstyle=|\son(click|input|submit|change|load|error)=["'$]/i.test(src), `${f} writes an inline style or handler`);
  }
});

test("boot.js runs first as a classic script, then the module; the shared look before the page's own", () => {
  const scripts = [...html.matchAll(/<script ([^>]*)><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(scripts, ['src="passwords/boot.js?v=2"', 'type="module" src="passwords/app.js?v=2"']);
  const css = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(css, ["shared/ed-ui.css?v=2", "passwords/styles.css?v=2"]);
});

test("the dashboard gear opens this page (PR B, after Alvin's phone check 2026-10-18)", () => {
  const index = readFileSync(new URL("index.html", root), "utf8");
  assert.ok(index.includes('class="settings-link" href="passwords.html"'));
  assert.ok(!index.includes("mgh-ed-hiring/passwords.html"), "no link to hiring's old page");
});

test("styles.css uses only the shared --ed-* tokens for colour", () => {
  const css = readFileSync(new URL("passwords/styles.css", root), "utf8");
  const vars = [...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
  assert.deepEqual(vars.filter((v) => !v.startsWith("--ed-")), []);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(css), "a raw colour");
});
