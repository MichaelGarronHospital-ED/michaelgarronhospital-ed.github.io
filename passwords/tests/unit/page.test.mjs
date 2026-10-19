// The page's own rules (design B.6.1): the content policy exactly as designed,
// no inline script or style anywhere (the policy would block it), the shared
// look loaded first and unchanged, and nothing that links to the page yet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { SDK_BASE } from "../../store.js";

const root = new URL("../../../", import.meta.url);
const html = readFileSync(new URL("passwords.html", root), "utf8");
const POLICY = "default-src 'none'; script-src 'self' https://www.gstatic.com/firebasejs/12.19.0/; style-src 'self'; img-src 'self'; connect-src https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://www.googleapis.com; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

test("the content policy is B.6.1's, as a meta tag", () => {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(m);
  assert.equal(m[1].replace(/\s+/g, " "), POLICY);
});

test("the policy allows scripts from exactly the Firebase SDK folder the page loads", () => {
  const src = POLICY.match(/script-src ([^;]+)/)[1].split(" ");
  assert.deepEqual(src, ["'self'", SDK_BASE]);
  assert.match(SDK_BASE, /^https:\/\/www\.gstatic\.com\/firebasejs\/\d+\.\d+\.\d+\/$/);
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

test("boot.js runs first as a classic script, then theme.js, then the module; the shared look, the theme, then the page's own", () => {
  const scripts = [...html.matchAll(/<script ([^>]*)><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(scripts, ['src="passwords/boot.js?v=7"', 'src="theme.js?v=7"', 'type="module" src="passwords/app.js?v=7"']);
  const css = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(css, ["shared/ed-ui.css?v=7", "theme.css?v=7", "passwords/styles.css?v=7"]);
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

test("no visible \"Leadership\" comes back; the hidden names stay (Alvin 2026-10-18: Admin)", async () => {
  const core = await import(new URL("passwords/core.js?guard", root).href);
  const { ROLES, ROLE_WORD, TEXT } = core;
  for (const v of Object.values(TEXT)) if (typeof v === "string") assert.doesNotMatch(v, /Leadership/, v);
  assert.equal(ROLE_WORD.leadership, "Admin");
  assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, ""), /Leadership/);
  const gear = readFileSync(new URL("index.html", root), "utf8").match(/<a class="settings-link"[^>]*>/)[0];
  assert.doesNotMatch(gear, /Leadership/);
  assert.equal(ROLES[0], "leadership", "the role key stays: the saved copy uses it");
  assert.equal(core.MAIN_KEY, "admin:leadership");
});


test("Log out follows the ED tools standard (2026-10-19): the words, the button, the messages", async () => {
  const btn = html.match(/<button id="logout"[^>]*>([^<]*)<\/button>/);
  assert.ok(btn, "no Log out button");
  assert.equal(btn[1], "Log out");
  assert.match(btn[0], /\sclass="ed-btn ed-btn-plain"/);
  assert.match(btn[0], /\stype="button"/);
  assert.doesNotMatch(btn[0], /\s(title|aria-label)=/);
  // the last item in the header
  const header = html.match(/<header id="top"[^>]*>([\s\S]*?)<\/header>/)[1].trim();
  assert.ok(header.endsWith(btn[0]), "Log out is not the last item in the header");
  const app = readFileSync(new URL("passwords/app.js", root), "utf8");
  assert.ok(app.includes('b.disabled = true; b.textContent = "Logging out…";'), "no Logging out state");
  const { TEXT } = await import(new URL("passwords/core.js?guard", root).href);
  assert.equal(TEXT.loggedOut, "You are logged out.");
  for (const k of ["idleOut", "hiddenOut", "signedOut"]) assert.match(TEXT[k], /^You were logged out\b/, k);
  for (const v of Object.values(TEXT)) if (typeof v === "string") assert.doesNotMatch(v, /signed out|sign out/i, v);
});
