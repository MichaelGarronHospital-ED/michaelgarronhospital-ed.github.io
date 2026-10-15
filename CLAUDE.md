# MGH ED Tools dashboard: notes for Claude

The front page of the MGH ED GitHub org: one tile per ED tool.
Live at https://michaelgarronhospital-ed.github.io/ (this repo's name makes it the org root).

## Stack and commands

- Plain HTML, CSS and JS. No build, no dependencies, no tests.
- Preview: `python3 -m http.server 8000`, then open http://localhost:8000
  (opening index.html from disk will not load tools.json).
- Add, rename or remove a tool: edit `tools.json`, the `<noscript>` list in `index.html`,
  and the table in `README.md`.

## Look

`shared/ed-ui.css` is the master copy of the shared ED look (tokens and `ed-` classes);
`index.html` and `404.html` load it before `styles.css`. Read its header before changing it:
copies live in the other tool repos and must stay identical.

## Deploy

GitHub Pages from `main`, root folder. A push to `main` is live about a minute later.
Ruleset "Protect main" blocks force-pushes and branch deletion only.

## Accounts

- Repo: github.com/MichaelGarronHospital-ED/michaelgarronhospital-ed.github.io (public).
- Owned by the department: org owner login `MGH-ED-Admin` on
  MGHEmergencyDepartmentAdministration@tehn.ca. No other services.

## Rules

- Public repo: never put a password, code or admin link in it.
- Never rename this repo (it would move the dashboard off the org root address).
- Local folder is `MGH-ED-Tools/dashboard`; see `../README.md` for the whole set of tools.
