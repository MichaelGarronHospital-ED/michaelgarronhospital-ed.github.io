// ============================================================================
//  Builds passwords/tests/site/ (git-ignored): a copy of the passwords page
//  for the page flows, pointed at the LOCAL emulators only.
//    - every Firebase app connects to the emulators (Auth 9096, Firestore 8086)
//    - the content policy also allows those two local addresses, nothing else
//    - all three web configs use the demo project demo-mgh-ed-admin (a demo-
//      project never talks to a real one) and invented keys
//    - the admin account gets the test uid, in config.js and in the rules copy
//    - every changed file carries the test-build marker, so the repo-hygiene
//      test fails if one is ever committed
//  Usage: node make-site.mjs
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const SITE = path.join(HERE, "site");
export const MARKER = "PASSWORDS-TEST-" + "BUILD-ONLY";
export const PROJECT = "demo-mgh-ed-admin";
export const TEST_UID = "TestAdminUid000000000000001";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9096";
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8086";

function replaceOnce(text, from, to, what) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`make-site: expected exactly one ${what}, found ${n}`);
  return text.replace(from, to);
}
function copy(rel) {
  const to = path.join(SITE, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(REPO, rel), to);
}
const write = (rel, text) => { const to = path.join(SITE, rel); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, text); };
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

export function makeSite() {
  fs.rmSync(SITE, { recursive: true, force: true });
  copy("shared/ed-ui.css");
  copy("icons/favicon.svg");
  for (const f of fs.readdirSync(path.join(REPO, "passwords")))
    if (/\.(js|css)$/.test(f)) copy(path.join("passwords", f));

  // the page: its policy also allows the two local emulators
  let html = read("passwords.html");
  html = replaceOnce(html, "connect-src https://identitytoolkit.googleapis.com", `connect-src http://${AUTH_HOST} http://${FS_HOST} https://identitytoolkit.googleapis.com`, "connect-src");
  html = replaceOnce(html, "<head>", `<head>\n  <!-- ${MARKER}: test copy for the emulators -->`, "head");
  write("passwords.html", html);

  // the page module: every app to the emulators
  let app = read("passwords/app.js");
  app = replaceOnce(app, "const EMULATORS = null;",
    `const EMULATORS = { auth: "http://${AUTH_HOST}", firestore: { host: "${FS_HOST.split(":")[0]}", port: ${Number(FS_HOST.split(":")[1])} } }; // ${MARKER}`, "EMULATORS line");
  write("passwords/app.js", app);

  // the configs: demo project, invented keys, the test admin uid
  let cfg = read("passwords/config.js");
  cfg = replaceOnce(cfg, 'apiKey: "NOT-CREATED-YET"', 'apiKey: "demo-admin-key"', "admin apiKey");
  cfg = replaceOnce(cfg, 'appId: "NOT-CREATED-YET"', 'appId: "demo-admin-app"', "admin appId");
  cfg = replaceOnce(cfg, 'projectId: "mgh-ed-admin"', `projectId: "${PROJECT}"`, "admin projectId");
  cfg = replaceOnce(cfg, 'projectId: "mgh-ed-hiring"', `projectId: "${PROJECT}"`, "hiring projectId");
  cfg = replaceOnce(cfg, 'projectId: "ed-motion-voting-99b96"', `projectId: "${PROJECT}"`, "voting projectId");
  cfg = cfg.replace(/apiKey: "AIza[^"]+"/g, 'apiKey: "demo-tool-key"');
  cfg = replaceOnce(cfg, 'email: "leadership@mgh-ed-admin.invalid", uid: ""', `email: "leadership@mgh-ed-admin.invalid", uid: "${TEST_UID}"`, "admin uid");
  cfg += `\n// ${MARKER}\n`;
  write("passwords/config.js", cfg);

  // the rules with the test uid
  let rules = read("passwords/firestore.rules");
  rules = replaceOnce(rules, "'ADMIN_UID_NOT_SET'", `'${TEST_UID}'`, "rules uid");
  write("passwords/firestore.rules", `// ${MARKER}\n${rules}`);

  // the page exactly as it is in the repo (not set up yet: it must not sign in)
  for (const rel of ["passwords.html", "shared/ed-ui.css", "icons/favicon.svg", ...fs.readdirSync(path.join(REPO, "passwords")).filter((f) => /\.(js|css)$/.test(f)).map((f) => `passwords/${f}`)]) {
    const to = path.join(SITE, "live", rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), to);
  }

  // a page that puts the passwords page in a frame (it must refuse)
  write("frame.html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Frame test</title></head>
<body><!-- ${MARKER} --><iframe id="f" src="passwords.html" title="framed" width="600" height="400"></iframe></body></html>\n`);
  return SITE;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  makeSite();
  console.log(`make-site: built ${path.relative(process.cwd(), SITE) || SITE}`);
}
