# MGH ED Tools dashboard: notes for Claude

The front page of the MGH ED GitHub org: one tile per ED tool.
Live at https://michaelgarronhospital-ed.github.io/ (this repo's name makes it the org root).

## Stack and commands

- Plain HTML, CSS and JS. No build, no dependencies. Checks: `python3 scripts/check_tools.py`
  (standard library only; `--write` rewrites the fallback list, `--live` HEADs every link);
  tests in `tests/`: `python3 -m unittest discover -s tests -p 'test_check_tools.py'` and
  `~/.venvs/mgh-ed-tools/bin/python -m unittest discover -s tests -p 'test_page.py'`
  (Playwright, Chromium and WebKit). `bash ../check-all.sh` runs them all.
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

`.github/workflows/check.yml` (push only, any branch, no schedule) runs the check. It saves
the regenerated fallback list to `main` only (never to other branches: that would take the
green tick off a pull request). If "Protect main" ever requires a pull request, the bot's
push to `main` fails: then add GitHub Actions as a bypass actor in the ruleset, or delete
the save step (the local check still catches drift). Do not make the check a required
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
