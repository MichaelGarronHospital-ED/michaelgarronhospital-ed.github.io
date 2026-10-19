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

**Focus rings (2026-10-19).** A focusable control never gets `outline: none` alone: use
`outline: 2px solid transparent` next to the `box-shadow` ring (Windows high contrast drops
box-shadow but paints the outline). For the tool rows the outline is on
`.card:has(.main:focus-visible)`, inset like its ring. Only a heading or container focused by
script keeps `outline: none` (`.main:focus-visible` hands its ring to the card).

**Light and dark switch (2026-10-19, Alvin).** The round moon/sun button left of the gear
(`.theme-toggle`, `[data-theme-toggle]`) flips this repo's pages between light and dark.
`theme.js` (plain script in `<head>` of index, 404 and passwords pages, before drawing) keeps
the choice in `localStorage` `ed_theme` and sets `<html data-theme>`; a choice stays until
the person presses the switch again (never cleared by the device changing at sunset);
pressing it back to the device's own look clears it, so the page follows the device again.
On the passwords page it loads as `theme.js?v=<n>` with that page's version: bump them all
when theme.js or theme.css change (`passwords.yml` runs on both files). `theme.css` (after `ed-ui.css`)
repeats ed-ui.css's light and dark token values under `:root[data-theme]`, screen only (print
stays light); `ThemeTokens` in `tests/test_check_tools.py` fails if they drift, so change a
colour in `shared/ed-ui.css` first, then `theme.css`. Kept out of `shared/` on purpose: the
other tools still follow the device and need no release. Anything dark-only in `styles.css`
needs both selectors (see `.icon`). The button starts `hidden` and theme.js shows it, so it
never appears dead without JavaScript. At 320px the hospital name drops to its own line.
Tests: `ThemeSwitch` in `tests/test_page.py`.

**Share button (2026-10-19, Alvin).** Every row has `.share` (app.js `shareButton`,
`shareTool`) for the tool's main `url`, never a `related` link. Touch-first devices
(`pointer: coarse`) use `navigator.share` (cancel or "already open" does nothing; another
error copies instead); computers always copy (a Windows share window is little use on a
hospital PC) and say "Link copied" in `#share-toast`, which is made empty when the tiles are
drawn so screen readers announce it; if copying is blocked, a clicked `mailto:` link. The
old-way copy box (`.copy-box`) sits fixed at the top so the page never scrolls, and focus
returns to the button. It sits above the stretched main link (`z-index: 1`), like `.related`;
clicking it must never open the tool. Hidden in print. Tests: `ShareButton` in
`tests/test_page.py` (share sheet and clipboard stubbed).

## Deploy

GitHub Pages from `main`, root folder. A push to `main` is live about a minute later.
Ruleset "Protect main" blocks force-pushes and branch deletion only.

`.github/dependabot.yml` (2026-10-19): monthly, one grouped pull request for the Actions (kept
pinned by hash) and one for `passwords/tests` npm tools, releases at least 14 days old.
Merge one only when its checks are green, like any other pull request.

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
- `passwords/core.js` holds every rule and every message. It started as a copy of hiring's
  `js/passwords.js`, which was deleted in R10, so there is nothing left to keep it in step
  with; its words were last tidied in the UX pass (2026-10-18: shorter intro and hint, no
  sign-in lead line). Show and Copy on each row are icon buttons with hover text (app.js).
- Log out follows the ED tools' Log out standard (2026-10-19): `#logout` is the last item
  in the header, `ed-btn ed-btn-plain`, and reads "Logging out…" (disabled) while it works
  (app.js `onLogout`); the gate then says "You are logged out." in grey. It can't run during
  a change (the dialog makes the header inert; `running` is checked too). Messages about
  sessions say "logged out"; code names (`signOut`, `"signed-out"`) stay. Tests: page.test.mjs
  (words and button) and flow 12b.
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
- Firebase SDK: loaded from gstatic, version only in `SDK_BASE` (`passwords/store.js`) and
  the content policy's `script-src` in `passwords.html` (a unit test keeps them equal; the
  flows cache the files per version in `tests/site-cache/<version>/`). 12.19.0 since
  2026-10-19. Change both by hand, bump every `?v=`, run `npm test`; Dependabot does not
  see it.
- `.github/workflows/passwords.yml` runs unit, rules and flows (Chrome) on changes to
  these files only. `check.yml` and `scripts/check_tools.py` do not look at this page.
- Live Firebase (`mgh-ed-admin`): created, the account made and rules published only by
  the steps in the design, with Alvin. Never from a test.
