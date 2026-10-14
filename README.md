# MGH ED Tools — dashboard

The front page for every web tool built for the Michael Garron Hospital
Emergency Department. It is a page of tiles; each tile links to one tool.

**Live:** https://michaelgarronhospital-ed.github.io/

This repo only holds the dashboard. Each tool has its own repo, its own data
and its own sign-in. The dashboard stores no passwords, no data and no logins.

## The tools

| Tool | Who uses it | Sign-in | Live site | Repo | Data / backend |
|---|---|---|---|---|---|
| Motion Voting | ED physicians at meetings; admins run it from the admin page (linked on the same tile) | Voters pick their name; leadership uses a passcode | [site](https://michaelgarronhospital-ed.github.io/mgh-ed-motion-voting/) | [mgh-ed-motion-voting](https://github.com/MichaelGarronHospital-ED/mgh-ed-motion-voting) | Firebase project `ed-motion-voting-99b96` |
| Physician Hiring | Hiring committee; applicants book times | Committee code; applicants use `book.html` | [site](https://michaelgarronhospital-ed.github.io/mgh-ed-hiring/) | [mgh-ed-hiring](https://github.com/MichaelGarronHospital-ED/mgh-ed-hiring) | Firebase (see that repo's README) |
| ED Hub | ED physicians | Hospital Microsoft sign-in | [site](https://tehn.sharepoint.com/sites/EDResourcesandReferralSupports) | none (SharePoint / Teams) | SharePoint site "ED Resources and Referral Supports" (hospital Microsoft 365) |
| CPOE Order Review | ~70 physician, pharmacy, lab, DI and nursing reviewers before the Feb 2027 Cerner go-live | Access code | [site](https://mghcpoe.pythonanywhere.com) | private (still on the maintainer's account) | PythonAnywhere account "mghcpoe" |
| Patient Hub | Patients and families (public); editors use the content editor and Map Studio (linked on the same tile) | None for patients; editors sign in with GitHub | [site](https://mgh-ed-patient-hub.pages.dev) | [mgh-ed-patient-hub](https://github.com/MichaelGarronHospital-ED/mgh-ed-patient-hub) (private) | Cloudflare Pages |

Each tool's own README explains how it works, how to deploy it and how to
change its codes. Start there for anything inside a tool.

## How this site works

No framework, no build step, no dependencies. Open the files in any editor.

| File | What it does |
|---|---|
| `tools.json` | **The list of tools.** One entry per card; `group` sets the section heading it appears under (groups show in the order first used). This is the only file you edit to add, rename, move or remove a tool. |
| `index.html` | Page layout and heading. Also holds a plain-link fallback list for browsers with JavaScript off. |
| `app.js` | Reads `tools.json` and builds the tiles. |
| `styles.css` | Look and feel, including dark mode. |
| `404.html` | Shown for any mistyped or dead address on this domain, with a button back to the dashboard. |
| `icons/` | One SVG icon per tool, the favicon, and `apple-touch-icon.png` (the icon when someone adds the dashboard to their phone's home screen; also the link-preview image). |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are. |

### Add a tool

1. Add an icon to `icons/` (a 24×24 SVG with white strokes; copy an existing one).
2. Add an entry to `tools.json`:
   ```json
   {
     "name": "Tool Name",
     "group": "For the ED team",
     "description": "One short line on what it does.",
     "url": "https://…/",
     "icon": "icons/tool-name.svg",
     "color": "green",
     "access": "Committee code",
     "repo": "https://github.com/MichaelGarronHospital-ED/…",
     "owner": "Name"
   }
   ```
   `color` is one of: blue, indigo, teal, green, orange, pink, red, gray.
   `access` is a short hint shown on the tile. **Never put a password or code here** — this repo is public.

   Optional `related` adds a few staff links inside the same tile, under a hairline,
   so a tool's editors are shown as part of it (Patient Hub uses this):
   ```json
   "related": {
     "label": "For admins",
     "access": "GitHub sign-in",
     "links": [ { "name": "Content editor", "url": "https://…/admin/" } ]
   }
   ```
   Clicking anywhere else on the tile still opens `url`. An optional `"note"` adds a
   one-line caption under the links, for when they need different sign-ins.
3. Add the tool (and any `related` links) to the `<noscript>` list in `index.html` and to the table above.
4. Commit to `main`. The site updates about a minute later.

### Rules

- Link each tile to the tool's **public entry page**. A staff page may appear under
  `related` only if a sign-in or passcode protects it (Patient Hub's editors need GitHub
  write access; the voting admin page needs the admin passcode, and Firebase
  refuses changes from anyone not signed in as leadership). Never rely on an unusual
  address alone: this repo and the tool repos are public.
- Keep the dashboard free of secrets, sign-in logic and tool data.

### Preview locally

```sh
python3 -m http.server 8000
```
Then open http://localhost:8000. (Opening `index.html` directly from disk won't
load `tools.json`; browsers block that.)

## Hosting

GitHub Pages, from the `main` branch, root folder. Because the repo is named
`michaelgarronhospital-ed.github.io`, it is served at the root of the org's
address, and the tool repos are served beneath it (`/mgh-ed-hiring/`, …).
Renaming this repo would move the dashboard off that address.

## Old addresses

Until 2026-10-13 the voting and hiring tools lived in one personal repo,
`DrAlvinYang/ED-motion-voting` (served at `dralvinyang.github.io/ED-motion-voting/`).
That repo is now archived and only redirects: `tools/motion-voting/…` →
`mgh-ed-motion-voting/…`, `tools/interviews/…` → `mgh-ed-hiring/…`, anything
else → this dashboard. Share only the new addresses. The old repo is kept as a
redirect until **2027-06-30**; after that, old links and QR codes stop working.

## Working on these repos locally

Keep every repo of this org side by side in one parent folder (the maintainer
uses `MGH-ED-Tools/`), one subfolder per repo. The local folder names are short;
the GitHub repo names stay as they are, because renaming a repo changes its live
address:

```
MGH-ED-Tools/
  dashboard/            michaelgarronhospital-ed.github.io (this repo)
  motion-voting/        mgh-ed-motion-voting
  hiring-tool/          mgh-ed-hiring
  patient-hub/          mgh-ed-patient-hub
  patient-hub-notes/    mgh-ed-patient-hub-notes (private notes; not deployed)
```

`MGH-ED-Tools/README.md` (not in any repo) has the full map of every tool,
its accounts and how to deploy it.

## Ownership and handover

The ED owns these tools through a **shared department mailbox**, not through any
one person:

**`MGHEmergencyDepartmentAdministration@tehn.ca`** ("MGH Emergency Department
Administration"). Created by TEHN IT on 2026-10-13, authorized by the ED
manager. Named ED staff have Read/Manage access; ask TEHN IT (Helpdesk) to add
or remove people.

That mailbox is the login for a department account on each service:

| Service | Department account | Role |
|---|---|---|
| GitHub (this org) | `MGH-ED-Admin` | Owner |
| Firebase: `ed-motion-voting-99b96` (voting), `mgh-ed-hiring` (hiring) | Google account on the mailbox | Owner |
| Cloudflare | Account on the mailbox | Owner. Patient Hub runs here (project `mgh-ed-patient-hub`) since 2026-10-14. The old address `mgh-ed-patient-guide.pages.dev` only redirects and is due to be retired around 2027-01-14. |

- Every department account has two-factor sign-in. Its password and backup
  codes are kept by the ED, not by an individual.
- Anyone who can open the mailbox can reset these passwords, so keep the
  mailbox's member list short and current.
- GitHub org owners today: `DrAlvinYang` (maintainer), `MGH-ED-Admin` (ED),
  `MichaelGarronHospital-TEHN` (Communications). Keep at least two.
- The org requires two-factor sign-in for everyone.
- Current maintainer: Alvin Yang.
- Checked 2026-10-14: every repo in this org can be updated and deployed using only
  the department login `MGH-ED-Admin` (no personal account involved).
