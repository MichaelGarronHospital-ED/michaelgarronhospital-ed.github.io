# MGH ED Tools: dashboard

The front page for every web tool built for the Michael Garron Hospital
Emergency Department. It is a page of tiles; each tile links to one tool.

**Live:** https://michaelgarronhospital-ed.github.io/

This repo only holds the dashboard. Each tool has its own repo, its own data
and its own sign-in. This repo holds no passwords, no data and no logins. The one
sign-in page here, the passwords page, keeps its encrypted copy in a separate Firebase
project (see "Passwords page" below).

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
| `tests/` | Tests for the check (`test_check_tools.py`) and for the page in a real browser (`test_page.py`). They use a frozen copy of the tool list in `tests/fixtures/`, so changing the real `tools.json` never breaks them; do not update the fixture when you change a tool. Not part of the page. |
| `.github/workflows/check.yml` | Runs the check after each save on GitHub (about 15 seconds, free for this public repo, no schedule). The check itself can only read. On `main` only, a second small job then saves the updated plain list itself. |
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
- Keep the dashboard free of secrets, sign-in logic and tool data. The only exception is
  the passwords page (`passwords.html`, `passwords/`), which signs in to Firebase; it still
  never holds a password in the repo.

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

## Passwords page

**Address:** https://michaelgarronhospital-ed.github.io/passwords.html (Leadership only).
**Opened by the gear** at the top right of the dashboard (since 2026-10-18, after Alvin's phone
check). `passwords/tests/unit/page.test.mjs` and `tests/test_page.py` check the gear's address.

### What it does

Anyone with the Leadership password signs in and sees the three shared passwords
(Leadership, ED, Guest), each hidden as 10 dots, with Show, Copy and Change. Change asks
only for the new password twice: the page signs in to each account with the saved current
value seconds before changing it, in a fixed order, so Physician Hiring, Motion Voting and
the Patient Hub statistics page always end up with the same three passwords.

- **Keep the page open until it says Done.** A computer warns before closing the page
  while a change runs; iPhone Safari does not show that warning.
- **If a change stops part way** (a closed tab, a lost connection): open the page on any
  device and press **Finish the change**. It first shows what it sets the password to
  (hidden until Show), so a change nobody here started can be spotted. Nothing needs
  typing, except in one case: a Leadership change stopped before anything changed asks
  for the new Leadership password again (**Go on**), or offers **Cancel this change**.
- **Stuck with only Go on, and nobody knows the new Leadership password:** the way out is
  the maintainer's `set-passwords.py --apply` (in the workspace), which sets all three
  passwords and makes a new saved copy.
- **If a tool's password was changed another way** (the Firebase console, the maintainer's
  script), the page says which tool no longer takes the saved one and asks for the one in
  use. If the tools then disagree, it asks for one new password for all of them.
- **First time, or after the Leadership password was changed outside this page:** the page
  asks for the ED and Guest passwords in use now, checks them with every tool, and saves a
  new encrypted copy.

### How it works

- One sign-in page in this repo: `passwords.html` with `passwords/`. Plain files, no build.
- It signs in to one account, `leadership@mgh-ed-admin.invalid`, in its own free Firebase
  project **`mgh-ed-admin`** ("MGH ED Admin", Spark plan, Firestore in Montreal). That
  project holds one document, `vault/main`: the three passwords, **encrypted in the
  browser** with a key made from the Leadership password (600,000 rounds). Firebase only
  ever sees the scrambled copy. The rules (`passwords/firestore.rules`) let only that one
  account, known by its uid, read or write it.
- To change a tool's password it signs in to that tool's account in a separate,
  memory-only helper. It never reads or writes Physician Hiring's or Motion Voting's data.
- **No password is ever in this repo**, in a test, or in a log. The sign-in lasts while
  the tab is open; a reload, Log out, 10 minutes without use or 5 minutes in the
  background signs out.
- **Never delete the `mgh-ed-admin` account.** The rules and `passwords/config.js` know
  it by its uid; a new account gets a new uid and the page refuses it until both are
  updated (`set-passwords.py --apply` recreates it and says "Republish the rules with this
  uid"). A test keeps the uid in `config.js` equal to the one in `firestore.rules`.

### Honest limits

- Anyone with the Leadership password can see the ED and Guest passwords. That is the
  point: only Leadership-password holders get in.
- Whoever can read the scrambled copy (Owners of `mgh-ed-admin`, Google) could try to
  guess the Leadership password offline. 600,000 rounds per guess makes a three or four
  word password slow to guess, not impossible. Those Owners can already reset any account.
- An Owner restoring an old copy of the document makes the page show old values; the
  check when the page opens reports them.
- While the tab is open the passwords are in its memory. Copy uses the clipboard, which
  Apple devices may share between devices.
- This page shares its web address with Physician Hiring and Motion Voting: a flaw in any
  ED tool page could reach this one. It refuses to run in a frame and has a strict
  content policy, which help.
- Anyone who can change this repo can change the page. Review every change to
  `passwords.html` and `passwords/` with care.
- During a Leadership change, someone who knows only the old Leadership password can still
  read the saved copy for a while: from the start of the change until the page's own
  account has the new password, and for up to about an hour after (a sign-in stays valid
  that long). They could then try to guess the new Leadership password offline. Choose a
  strong new Leadership password: three or four words.

### Files

| File | What it does |
|---|---|
| `passwords.html` | The page, with its content policy. |
| `passwords/boot.js` | Runs first: refuses to run in a frame, and says so if the page didn't finish loading. |
| `passwords/app.js` | Sign-in, the three rows and the dialogs. |
| `passwords/core.js` | Every rule of a change (a port of Physician Hiring's `js/passwords.js`) and every message. |
| `passwords/vault.js` | The encryption. |
| `passwords/store.js` | Reads the vault once, writes it in a way that notices another device's change. |
| `passwords/util.js`, `passwords/styles.css` | Helpers and layout (only the shared `--ed-*` look). |
| `passwords/config.js` | Public web configs and the six accounts (emails and uids). No password. |
| `passwords/vault-cli.mjs` | For the maintainer's `set-passwords.py`: seals and checks the vault from a terminal. |
| `passwords/firestore.rules`, `firebase.json`, `.firebaserc` | The vault rules and the emulator settings. |
| `passwords/tests/` | Tests only (dev-only tools). GitHub Pages publishes this folder too, as it publishes every file in this public repo; nothing in it is secret. |
| `.github/workflows/passwords.yml` | Runs the tests on GitHub when these files change (free, no schedule). |

Every script on the page carries the same `?v=` number; change them all together (a test
checks).

### Tests (on a computer)

```sh
cd passwords/tests
mkdir -p node_modules && xattr -w 'com.apple.fileprovider.ignore#P' 1 node_modules   # keep it out of iCloud (Mac)
npm ci
npx playwright-core install chromium webkit   # the test browsers, once (skip Chromium if CHROME is set)
npm run test:unit     # rules of a change, encryption, hygiene, about 15 seconds
npm run test:rules    # the vault rules in the Firestore emulator
npm run test:flows    # the page in Chromium and WebKit against the emulators
npm test              # all three
```

The emulators run as the demo project `demo-mgh-ed-admin` (never a real one) on ports
8086 (Firestore), 9096 (Auth), 4406 and 4506 (their helpers); the page is served on 8097.
`FLOW_BROWSERS=chromium` runs one browser; `CHROME=/path/to/chrome` uses that Chrome.
Every value in the tests is invented.

### Setting it up (once, by the maintainer)

Design `designs/passwords-design.md` (workspace, sections B.2 and B.10) has the steps:

1. The department account creates the project (B.2.2 A and B).
2. The account: `set-passwords.py --create-admin-account` (workspace). It prints the uid.
3. **Fill in, all in one commit:**
   - `passwords/config.js`: the `ADMIN_FIREBASE` values (`apiKey`, `appId`, from
     `apps:sdkconfig`), and the uid on the `admin:leadership` line;
   - `passwords/firestore.rules`: the same uid in place of `ADMIN_UID_NOT_SET`;
   - the workspace's `role-accounts.json`: the same uid as the "admin" account (a test
     compares it when the file is there);
   - this README: remove "(not created yet)" from the Firebase line under "Ownership and
     handover";
   - if this page was ever published before with the placeholders, bump every `?v=` in
     `passwords.html` and `passwords/` (a test keeps them equal).
   The tests still pass with the real values filled in.
4. Publish the rules. From `passwords/`:
   `tests/node_modules/.bin/firebase deploy --only firestore:rules --project mgh-ed-admin`.
5. Merge PR A (this page, not linked yet), then do the live checks of B.10 step 4 without
   the password: the page loads, the gate shows, no console error or policy violation
   (Chrome and Safari), a wrong password says "Incorrect password.", it refuses in a
   frame, and a phone screen has no sideways scroll.
6. The maintainer's phone check (B.10 step 5). **Before** the real Guest change and the
   change back, check that today's Guest password is at least 6 characters, has no word
   "password" in it, and no space at either end. If it isn't, the page would refuse to
   change it back: change it to a new value instead and keep that one.

Until step 3 the page says "This page is not ready yet" and never tries to sign in.

The rules ask for a salt of at least 24 characters (16 bytes in base64); design B.4 said 20.

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
| Firebase: `ed-motion-voting-99b96` (voting), `mgh-ed-hiring` (hiring), `mgh-ed-admin` (passwords page) | Google account on the mailbox | Owner (the only one for `mgh-ed-admin`) |
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
