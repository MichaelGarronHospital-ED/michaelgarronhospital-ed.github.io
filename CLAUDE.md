# MGH ED Tools dashboard: notes for Claude

The front page of the MGH ED GitHub org: one tile per ED tool.
Live at https://michaelgarronhospital-ed.github.io/ (this repo's name makes it the org root).

## Stack and commands

- Plain HTML, CSS and JS. No build, no dependencies (the passwords page's tests in
  `passwords/tests/` have dev-only ones). Checks: `python3 scripts/check_tools.py`
  (standard library only; `--write` rewrites the fallback list, `--live` HEADs every link);
  tests in `tests/`: `python3 -m unittest discover -s tests -p 'test_check_tools.py'` and
  `~/.venvs/mgh-ed-tools/bin/python -m unittest discover -s tests -p 'test_page.py'`
  (Playwright, Chromium and WebKit). `bash ../check-all.sh` runs them all. Tests use the
  frozen list in `tests/fixtures/`, never the live `tools.json` (except one page test that
  only loads the real list); never write a test that counts or names the live tools.
- Preview: `python3 -m http.server 8000`, then open http://localhost:8000
  (opening index.html from disk will not load tools.json).
- Add, rename or remove a tool: edit `tools.json` only (and optionally the README table).
  Never hand-edit the block between the `tools-fallback` markers in `index.html`: the check
  writes it (`--write` locally; the Action on `main`).

## Look

`shared/ed-ui.css` is the master copy of the shared ED look (tokens and `ed-` classes);
`index.html` and `404.html` load it before `styles.css`. Read its header before changing it:
copies live in the other tool repos and must stay identical.

## Deploy

GitHub Pages from `main`, root folder. A push to `main` is live about a minute later.
Ruleset "Protect main" blocks force-pushes and branch deletion only.

`.github/workflows/check.yml` (push only, any branch, no schedule) has two jobs: `check`
(read-only token) and `save`, which runs only on `SAVE_BRANCH` (`main`) after `check` passed
and is the only job with `contents: write` and `pages: write`. It saves the regenerated
fallback list to `main` only (never to other branches: that would take the green tick off a
pull request). If "Protect main" ever requires a pull request, the bot's push to `main`
fails: then add GitHub Actions as a bypass actor in the ruleset, or delete the `save` job
(the local check still catches drift). Do not make the check a required
status check (it would block the bot's own save and the "saved to main by mistake" path).

## Accounts

- Repo: github.com/MichaelGarronHospital-ED/michaelgarronhospital-ed.github.io (public).
- Owned by the department: org owner login `MGH-ED-Admin` on
  MGHEmergencyDepartmentAdministration@tehn.ca. No other services.

## Rules

- Public repo: never put a password or code in it. Links to staff pages are fine only when a
  password or sign-in protects the page (Alvin, 2026-10-15); see README "How this site works".
- Never rename this repo (it would move the dashboard off the org root address).
- Keep `tools.json` an array (top level `[...]`): a cached old `app.js` expects one.
- `"check": true` only for hosts in `CHECKABLE_HOSTS` (app.js; the checker enforces it).
  Never probe SharePoint (401) or CPOE (`Cross-Origin-Resource-Policy` makes every check
  fail). Only a tile's main `url` is checked, never `related` links.
- Keep `const COLORS = [...]` and `const CHECKABLE_HOSTS = [...]` each on one line in
  `app.js`; the checker reads them.
- All text: plain words, no em dashes (the checker fails on one in `tools.json`).
- Local folder is `MGH-ED-Tools/dashboard`; see `../README.md` for the whole set of tools.

## Passwords page (`passwords.html`, `passwords/`)

The one sign-in page in this repo (design: workspace `designs/passwords-design.md`, Phase B).
README "Passwords page" explains it for people. The dashboard gear (`index.html`,
`.settings-link`) opens it (since 2026-10-18); never point the gear anywhere else.

- Never a real password anywhere: not in the repo, a test, a commit or a log. Tests use
  invented values only. Nothing on the page may write a value to storage, the URL, the
  console or any Firestore field in clear (the flows check).
- People see the top password as **Admin** (Alvin, 2026-10-18; it was "Leadership"). Only
  visible words changed: the role key `leadership`, `roles.leadership` in the vault and
  pending changes, `admin:leadership`, the `leadership@` / `admin@` emails, uids, rules,
  storage keys and `vault-cli.mjs` keep the old word. Never rename them (it would sign
  people out or stop the saved copy opening). "ED leadership" meaning people stays.
- `passwords/core.js` holds every rule and every message; keep it close to hiring's
  `js/passwords.js` (same names, same adapter) so a reviewer can diff them.
- Content policy is in `passwords.html` (B.6.1, a test pins it): no inline script, no
  inline style, no `style=` or `on...=` attribute, even inside JS strings. Every `?v=` in
  `passwords/` and `passwords.html` is equal; bump them together.
- `passwords/config.js`: `ADMIN_FIREBASE` stays the FIRST object, with no nested braces
  (the workspace scripts read its apiKey with a pattern). The admin uid in `config.js`
  equals the one in `firestore.rules` (a test). Never delete the `mgh-ed-admin` account.
- `passwords/vault-cli.mjs` is a fixed interface for the workspace's `set-passwords.py`:
  `seal` and `check`, one JSON object on stdin, JSON on stdout, never a value printed.
  Do not change it without changing that script.
- Tests: `cd passwords/tests && npm test` (unit, rules, flows); `test:unit`, `test:rules`,
  `test:flows` alone. Emulators on 8086 / 9096 / 4406 / 4506, page on 8097, project
  `demo-mgh-ed-admin`; hiring's emulators use 8080 / 9099 and may run at the same time.
  `passwords/tests/site*/` and `node_modules/` are git-ignored; mark `node_modules` out of
  iCloud before `npm ci`.
- `.github/workflows/passwords.yml` runs unit, rules and flows (Chrome) on changes to
  these files only. `check.yml` and `scripts/check_tools.py` do not look at this page.
- Live Firebase (`mgh-ed-admin`): created, the account made and rules published only by
  the steps in the design, with Alvin. Never from a test.
