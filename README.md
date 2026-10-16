# MGH ED Tools: dashboard

The front page for every web tool built for the Michael Garron Hospital
Emergency Department. It is a page of tiles; each tile links to one tool.

**Live:** https://michaelgarronhospital-ed.github.io/

This repo only holds the dashboard. Each tool has its own repo, its own data
and its own sign-in. The dashboard stores no passwords, no data and no logins.

## The tools

| Tool | Who uses it | Sign-in | Live site | Repo | Data / backend |
|---|---|---|---|---|---|
| Motion Voting | ED physicians at meetings; admins run it from the admin page (linked on the same tile) | ED password, then voters pick their name; Leadership password for the admin page | [site](https://michaelgarronhospital-ed.github.io/mgh-ed-motion-voting/) | [mgh-ed-motion-voting](https://github.com/MichaelGarronHospital-ED/mgh-ed-motion-voting) | Firebase project `ed-motion-voting-99b96` |
| Physician Hiring | ED physicians; applicants book times | ED password (Leadership password for admin views); applicants use the Guest password at `book.html` | [site](https://michaelgarronhospital-ed.github.io/mgh-ed-hiring/) | [mgh-ed-hiring](https://github.com/MichaelGarronHospital-ED/mgh-ed-hiring) | Firebase (see that repo's README) |
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
| `index.html` | Page layout, heading and footer (owner and "Report a problem"). Also holds a plain list of every link, which shows when JavaScript is off or the tool list cannot be loaded. **That list is written for you** from `tools.json` by `scripts/check_tools.py`; never edit it by hand. |
| `app.js` | Reads `tools.json` and builds the tiles. Also shows notes and "Not loading right now" on tiles (see "Status on tiles"). |
| `shared/ed-ui.css` | The shared look for every ED staff tool (colours, font, buttons, lists; light and dark follow the device). This repo holds the master copy; the other tools keep exact copies. Do not edit it here only: see its header. |
| `styles.css` | This page's own layout, built on the shared look. |
| `404.html` | Shown for any mistyped or dead address on this domain, with a button back to the dashboard and a "Report a broken link" email link. |
| `icons/` | One SVG icon per tool, the favicon, and `apple-touch-icon.png` (the icon when someone adds the dashboard to their phone's home screen; also the link-preview image). |
| `scripts/check_tools.py` | The check. Finds mistakes in `tools.json` (missing comma, misspelt colour, missing icon, a password in a link) and writes the plain list in `index.html`. Runs by itself on GitHub after every save; also `python3 scripts/check_tools.py` on a computer. |
| `tests/` | Tests for the check (`test_check_tools.py`) and for the page in a real browser (`test_page.py`). Not part of the page. |
| `.github/workflows/check.yml` | Runs the check after each save on GitHub (about 15 seconds, free for this public repo, no schedule). On `main` it also saves the updated plain list itself. |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are. |

### Add, rename or remove a tool (on the GitHub website, no coding)

You only ever change one file: `tools.json`. A check runs by itself after you save and
tells you, in plain words, if anything is wrong. After you publish, it also updates the
plain backup list of links on the page, so you do not touch any other file.

**Before you start:** sign in to github.com with an account that can edit the
MichaelGarronHospital-ED organisation (for example the department login MGH-ED-Admin).

**1. Pick an icon.** The simplest choice is to reuse one already in the `icons` folder
(for example `icons/ed-hub.svg`). To add a new one: open the `icons` folder, click
**Add file**, then **Upload files**, and drop in a 24 by 24 SVG drawn with white lines.
Give it a short name with dashes, like `shift-swap.svg`. Ask whoever maintains the tools
if you are unsure; any existing icon is fine to start with.

**2. Open the list.** In the repository, click `tools.json`, then the pencil button
(**Edit this file**).

**3. Make your change.**
- *Add a tool:* copy the "CPOE Order Review" block (it has no brackets inside it, so it
  is the easiest to copy): from the `{` on the line above `"name": "CPOE Order Review"`
  down to the first `}` after it. Paste it after the last block and change the words
  inside the quotes. Blocks are separated by a comma: put a comma after the `}` of the
  block before yours. The last block has no comma after its `}`.
- *Rename:* change the text after `"name":`.
- *Move to another section:* change `"group":` to the heading you want. A new heading
  makes a new section.
- *Remove:* delete the whole block and the comma that separated it from its neighbour.
- *Show a short note on a tile* (for example planned work): add these two lines inside
  the block:
  `"notice": "Closed for updates until Friday 3 pm.",`
  `"notice_until": "2026-10-23",`
  The note disappears by itself after that date (year-month-day). `notice_until` is
  optional; without it the note stays until you delete the line. Delete both lines when
  you are done; the check reminds you once the date has passed.

Each block looks like this:

```json
{
  "name": "Shift Swap",
  "group": "For the ED team",
  "description": "Swap shifts with a colleague.",
  "url": "https://example.org/shift-swap/",
  "icon": "icons/shift-swap.svg",
  "color": "green",
  "owner": "ED Administration",
  "repo": ""
}
```

- `color` is one of: blue, indigo, teal, green, orange, pink, red, gray.
- `owner` is a team or role, never a person's name, so it stays right when people change jobs.
- `url` must start with `https://`. Never put a password or access code in a link:
  this page is public.
- Staff-only pages may be listed under `related` only if a password or sign-in
  protects them (see "Rules" below).
- `"check": true` (optional) lets the page show "Not loading right now" when the tool
  does not answer. It only works for addresses starting with
  `https://michaelgarronhospital-ed.github.io/` or `https://mgh-ed-patient-hub.pages.dev`;
  the check refuses it anywhere else.

**4. Save as a proposal, not straight to the live page.** Click **Commit changes...**.
Write a short note (for example "Add Shift Swap tool"). Choose **Create a new branch for
this commit and start a pull request**, then **Propose changes**, then **Create pull
request**.

**5. Wait about a minute for the check.** Near the bottom of the pull request you will
see a yellow dot, then a green tick or a red cross.
- *Green tick:* go to step 6.
- *Red cross:* click **Details**. The message names the tool and the problem, for
  example a missing comma or a misspelt colour. Click **Files changed**, then the three
  dots on `tools.json`, then **Edit file**, fix it, and click **Commit changes** (keep
  "Commit directly to the branch" selected, which is the proposal's own branch). The
  check runs again.

**6. Publish.** Click **Merge pull request**, then **Confirm merge**. The page updates
about a minute later. Open https://michaelgarronhospital-ed.github.io/ and check your tile.
If you added, renamed or removed a tool or link, a minute or so later you will also see
a save by "github-actions" in the history: that is the check updating the plain backup
list for you. That is normal.

**Undo:** open the merged pull request and click **Revert**. That makes a new pull
request that puts things back; merge it the same way.

**If you saved straight to main by mistake:** that is OK. The same check still runs and
emails you if something is wrong. If the list breaks, the page shows a plain list of the
main links until it is fixed.

**Optional:** also update "The tools" table above so the next person knows who uses
the tool and how they sign in. The check reminds you if a tool is missing from it.

### Status on tiles

- **"Not loading right now"**: for tools with `"check": true` (today Motion Voting,
  Physician Hiring and Patient Hub), the page sends one tiny request (no data, no
  sign-in, no visit counted) when someone opens it. A tile shows "Not loading right now"
  and a "Report it" email link only if the tool fails twice, the device itself is
  online, and the page stayed open on screen the whole time. When all is well, nothing
  shows. ED Hub (SharePoint) and CPOE are never checked: their answers cannot be read
  honestly from this page.
- **What it cannot see:** Firebase problems, sign-in problems, or anything inside a tool.
  For those, type a `notice` on the tile (step 3 above).
- **Turn it off for one tool:** delete the line `"check": true` from that tool's block.
  The page then sends no request for it.
- The real alarm is still the Patient Hub health check (every 6 hours), which emails the
  department mailbox. The tiles only tell the person looking at the page.

### Rules

- Link each tile to the tool's **public entry page**. A staff page may appear under
  `related` only if a sign-in or password protects it (Patient Hub's editors need GitHub
  write access; the voting admin page and Patient Hub statistics need the Leadership
  password, and Firebase
  refuses changes from anyone not signed in as leadership). Never rely on an unusual
  address alone: this repo and the tool repos are public.
- Keep the dashboard free of secrets, sign-in logic and tool data.

### Preview locally

```sh
python3 -m http.server 8000
```
Then open http://localhost:8000. (Opening `index.html` directly from disk won't
load `tools.json`; browsers block that.)

### Check before pushing (on a computer)

```sh
python3 scripts/check_tools.py           # finds mistakes; exit 1 if any
python3 scripts/check_tools.py --write   # also rewrites the plain list in index.html
python3 scripts/check_tools.py --live    # also asks every address if it answers (needs internet)
python3 -m unittest discover -s tests -p 'test_check_tools.py'
~/.venvs/mgh-ed-tools/bin/python -m unittest discover -s tests -p 'test_page.py'   # browser tests (Playwright)
```

`bash ../check-all.sh` runs all of these.

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
- Current maintainer: Alvin Yang. Contact the department mailbox, not a person.
- The page footer says the tools are run by MGH Emergency Department Administration
  (a role, not a person) and has "Report a problem": a prefilled email to the mailbox
  with "[ED tools]" at the start of the subject, so reports are easy to sort (an Outlook
  rule can file them into their own folder) and never bury sign-in or security emails.
  "For tool problems only. Not for medical questions." To switch it to a form later,
  change the one `href` of `id="report-link"` in `index.html` (the check expects an
  email link there today, so its contact rule in `scripts/check_tools.py` changes too).
- Checked 2026-10-14: every repo in this org can be updated and deployed using only
  the department login `MGH-ED-Admin` (no personal account involved).
