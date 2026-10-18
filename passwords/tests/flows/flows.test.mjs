// The passwords page end to end against the local emulators (design B.8.3,
// flows 1 to 14): Chromium at 1280 and WebKit at iPhone 13 size (390), light
// and dark. Chromium runs flows 1 to 12 in light and WebKit in dark; flows 13
// and 14 (page rules, accessibility) run in both. Every flow ends with the
// page's own rules: no policy violation, no page error, no request outside
// 127.0.0.1 and gstatic, and no test value in either storage, IndexedDB, the
// console, the address or cookies. Every value is invented.
//   npm run test:flows                      (both browsers)
//   FLOW_BROWSERS=chromium npm run test:flows
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as H from "./harness.mjs";
import { TEXT, staleText, differText, sameAsText, staleRowText, failureText, gateWrongText, blockedBy } from "../../core.js";

const V = H.V;
const AXE = fs.readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag2aaa", "wcag21aa", "wcag22aa"];   // as the dashboard's page tests
const T = { timeout: 240000 };
const SCHEME = { chromium: "light", webkit: "dark" };
const WORD = { leadership: "Admin", ed: "ED", guest: "Guest" };
const CUR = { leadership: V.lead, ed: V.ed, guest: V.guest };
const ADMIN = H.emailOf("admin:leadership");
const DOTS = "•".repeat(10);
// aborted requests in the stop-part-way flows are logged by the browser and the SDK
const ABORTED = [/RPC_ERROR|net::ERR_FAILED|Load failed|Failed to fetch|network|RestConnection|FirebaseError|unavailable/i];

before(H.startServer);
after(H.stopServer);

for (const kind of H.browsersToRun()) {
  describe(H.KINDS[kind].name, () => {
    let B;
    before(async () => { B = await H.KINDS[kind].launch(); });
    after(async () => { if (B) await B.close(); });
    const open = (opts = {}) => H.newPage(B, kind, { scheme: SCHEME[kind], ...opts });
    const signedIn = async (pw = V.lead, opts = {}) => { const p = await open(opts); await H.signIn(p, pw); await H.onMain(p); return p; };
    const finish = async (p, { allowConsole = [] } = {}) => {
      assert.deepEqual(await H.pageProblems(p, { allowConsole }), [], "the page broke one of its rules");
      assert.deepEqual(await H.leaks(p), [], "a test value is where the page could have written it");
      await H.closePage(p);
    };
    const waitGate = (p, re) => p.waitForFunction((src) => new RegExp(src).test(document.querySelector("#gerr").textContent), re.source, { timeout: 30000 });
    const accepts = async (role, value) => { for (const k of H.keysOf(role)) assert.equal(await H.accepts(k, value), true, `${k} doesn't take the value`); };
    const refuses = async (role, value) => { for (const k of H.keysOf(role)) assert.equal(await H.accepts(k, value), false, `${k} still takes the value`); };
    const valueOf = (p, r) => p.$eval(`#val-${r}`, (e) => (e.querySelector("[aria-hidden]") ? e.querySelector("[aria-hidden]").textContent : e.textContent));
    // let the change go on until this account's update, then drop it (and every later commit, if commits)
    const dropUpdateOf = (p, key, { always = false } = {}) => {
      let dropped = false;
      p.__intercept = async (route, req) => {
        if (!req.url().includes("accounts:update")) return false;
        if (H.callOf(req).email !== H.emailOf(key) || (dropped && !always)) return false;
        dropped = true; await route.abort(); return true;
      };
    };
    const finishFromRow = async (p, role, value) => {
      await H.rowButton(p, role, "finish").click();
      await H.waitDialog(p, "Finish the change");
      assert.equal(await p.$eval("#finVal [aria-hidden]", (e) => e.textContent), DOTS, "the new value is shown before Show");
      await p.click("#finShow");
      assert.equal(await p.textContent("#finVal"), value);
      await p.click("#finShow");
      assert.ok(!(await p.textContent("#finVal")).includes(value));
      await H.dialogClick(p, "Finish the change");
    };
    const dropCommitsAfter = (p, n) => {
      let commits = 0;
      p.__intercept = async (route, req) => {
        if (!req.url().includes(":commit")) return false;
        commits++;
        if (commits <= n) return false;
        await route.abort(); return true;
      };
    };

    it("0 not set up yet (the repo's own files): a calm message, no field, no sign-in, nothing loaded from Firebase", T, async () => {
      const p = await open();
      p.__log.auth.length = 0;
      const requests = [];
      p.on("request", (r) => requests.push(r.url()));
      await p.goto(`${H.BASE}/live/passwords.html`);
      await p.waitForFunction("window.__edReady === true");
      await p.waitForTimeout(500);
      assert.equal(await p.textContent("#gateLead"), TEXT.notReady);
      assert.equal(await p.isVisible("#gateForm"), false);
      assert.equal(await p.isVisible("#gpw"), false);
      assert.deepEqual(requests.filter((u) => !u.startsWith(`${H.BASE}/live/`)), [], "it reached out");
      await finish(p);
    });

    it("1 first use: no vault; ED and Guest; Check and save; one lock; no test value in clear", T, async () => {
      await H.reset();
      const p = await open();
      await H.signIn(p, V.lead);
      await p.waitForSelector("#fuEd", { timeout: 30000 });
      assert.match(await p.textContent("#app"), /Type the ED and Guest passwords in use now/);
      await p.fill("#fuEd", V.ed); await p.fill("#fuGuest", V.guest);
      await p.click("#fuGo");
      await H.onMain(p);
      const raw = await H.rawVault();
      assert.equal(raw.gen, 1);
      assert.equal(raw.locks.length, 1);
      for (const v of H.ALL_VALUES()) assert.ok(!raw.text.includes(v), "a value in clear in the vault");
      assert.deepEqual((await H.openRaw(V.lead)).content.roles, CUR);
      await finish(p);
    });

    it("2 view: 10 dots; Show the right value; hides after 30 s and when the tab is hidden; Copy", T, async () => {
      await H.reset(); await H.seedVault(CUR);
      const p = await open({ clock: true });
      await H.signIn(p, V.lead); await H.onMain(p);
      for (const r of ["leadership", "ed", "guest"]) assert.equal(await valueOf(p, r), DOTS);
      await H.rowButton(p, "ed", "show").click();
      assert.equal(await valueOf(p, "ed"), V.ed);
      assert.equal(await H.rowButton(p, "ed", "show").textContent(), "Hide");
      await p.clock.fastForward(31000);
      assert.equal(await valueOf(p, "ed"), DOTS, "not hidden after 30 s");
      await H.rowButton(p, "ed", "show").click();
      assert.equal(await valueOf(p, "ed"), V.ed);
      await p.evaluate(() => window.__setHidden(true));
      assert.equal(await valueOf(p, "ed"), DOTS, "not hidden with the tab");
      await p.evaluate(() => window.__setHidden(false));
      await H.rowButton(p, "guest", "copy").click();
      await p.waitForFunction(() => {
        const b = document.querySelector('#row-guest button[data-act="copy"]');
        return b.textContent === "Copied" || String(getSelection()).length > 0;
      }, null, { timeout: 5000 });
      const copied = (await H.rowButton(p, "guest", "copy").textContent()) === "Copied";
      if (copied && kind === "chromium") assert.equal(await p.evaluate(() => navigator.clipboard.readText()), V.guest);
      if (!copied) assert.equal(await p.evaluate(() => String(getSelection())), V.guest, "blocked copy: not shown and selected");
      await finish(p);
    });

    it("3 change each role: every account takes the new value and refuses the old; Leadership ends with one lock", T, async () => {
      await H.reset(); await H.seedVault(CUR);
      const p = await signedIn();
      for (const [r, nv] of [["guest", V.guest2], ["ed", V.ed2], ["leadership", V.lead2]]) {
        await H.changeRole(p, r, nv);
        await H.waitDialog(p, "Done");
        const t = await H.dialogText(p);
        assert.match(t, /Never email a password/);
        assert.ok(!t.includes(nv), "the Done message holds the password");
        await H.dialogClick(p, "Close");
        await accepts(r, nv); await refuses(r, CUR[r]);
      }
      const raw = await H.rawVault();
      assert.equal(raw.locks.length, 1);
      assert.deepEqual((await H.openRaw(V.lead2)).content.roles, { leadership: V.lead2, ed: V.ed2, guest: V.guest2 });
      assert.equal(await H.openRaw(V.lead), null);
      await finish(p);
      const g = await open();
      await H.signIn(g, V.lead);
      await waitGate(g, /Incorrect password/);
      await H.signIn(g, V.lead2);
      await H.onMain(g);
      await finish(g);
    });

    it("4 half done: the second account fails once; a new page says it didn't finish, reports nothing stale; Finish, nothing typed", T, async () => {
      await H.reset(); await H.seedVault(CUR);
      const p = await signedIn();
      dropUpdateOf(p, "hiring:committee");
      await H.changeRole(p, "ed", V.ed2);
      await H.waitDialog(p, "Not finished");
      assert.match(await H.dialogText(p), /The ED password is new in Motion Voting but still old in Physician Hiring\./);
      await finish(p, { allowConsole: ABORTED });
      const q = await signedIn();
      assert.match(await H.rowText(q, "ed"), /A change of the ED password didn't finish \(started [A-Z][a-z]{2} \d+\)\./);
      assert.ok(!(await q.textContent("#app")).includes("doesn't accept"), "the quiet check reported the pending role as stale");
      await finishFromRow(q, "ed", V.ed2);
      await H.waitDialog(q, "Done");
      await accepts("ed", V.ed2); await refuses("ed", V.ed);
      await finish(q);
    });

    it("5 Leadership stopped after the page's own account: the old value is refused at the gate, the new one opens, Finish", T, async () => {
      await H.reset(); await H.seedVault(CUR);
      const p = await signedIn();
      dropUpdateOf(p, "voting:leadership", { always: true });
      await H.changeRole(p, "leadership", V.lead2);
      await H.waitDialog(p, "Not finished");
      assert.equal(await H.accepts("admin:leadership", V.lead2), true);
      assert.equal(await H.accepts("voting:leadership", V.lead), true);
      assert.equal((await H.rawVault()).locks.length, 1, "the OLD lock was not dropped");
      await finish(p, { allowConsole: ABORTED });
      const q = await open();
      await H.signIn(q, V.lead);
      await waitGate(q, /Incorrect password/);
      await H.signIn(q, V.lead2);
      await H.onMain(q);
      await finishFromRow(q, "leadership", V.lead2);
      await H.waitDialog(q, "Done");
      await accepts("leadership", V.lead2);
      await finish(q);
    });

    it("6 Leadership stopped after the start write: the old value opens without the new one; Cancel; again, then Go on", T, async () => {
      await H.reset(); await H.seedVault(CUR);
      const p = await signedIn();
      dropCommitsAfter(p, 1);
      await H.changeRole(p, "leadership", V.lead2);
      await H.waitDialog(p, "Not finished", 120000);
      assert.equal(await H.accepts("admin:leadership", V.lead), true, "an account changed");
      assert.equal((await H.rawVault()).locks.length, 2);
      await finish(p, { allowConsole: ABORTED });
      const old = await H.openRaw(V.lead);
      assert.equal(old.content.pending.role, "leadership");
      assert.ok(!("next" in old.content.pending), "the OLD lock holds the new value");
      const q = await open();
      await H.signIn(q, V.lead2);
      await waitGate(q, /Incorrect password/);
      await H.signIn(q, V.lead);
      await H.onMain(q);
      assert.match(await H.rowText(q, "leadership"), /An Admin change was started; nothing has changed yet\./);
      assert.ok(!(await q.content()).includes(V.lead2), "the new value is in the page");
      await H.rowButton(q, "leadership", "cancel").click();
      await H.waitDialog(q, "Cancel the Admin change?");
      await H.dialogClick(q, "Cancel the change");
      await H.waitDialog(q, "Cancelled");
      await H.dialogClick(q, "Close");
      assert.equal((await H.rawVault()).locks.length, 1);
      assert.equal((await H.openRaw(V.lead)).content.pending, null);
      // the second time: Go on with the new value
      dropCommitsAfter(q, 1);
      await H.changeRole(q, "leadership", V.lead2);
      await H.waitDialog(q, "Not finished", 120000);
      await finish(q, { allowConsole: ABORTED });
      const r = await signedIn(V.lead);
      assert.equal(await H.rowButton(r, "leadership", "finish").textContent(), "Go on");
      await H.rowButton(r, "leadership", "finish").click();
      await H.waitDialog(r, "Go on with the Admin change");
      await r.fill("#pwNext", V.wrong[0]);
      await H.dialogClick(r, "Go on");
      await r.waitForFunction((t) => document.querySelector("#pwErr").textContent === t, TEXT.notNext);
      await r.fill("#pwNext", V.lead2);
      await r.press("#pwNext", "Enter");          // Return presses Go on (round 1 D-M2)
      await H.waitDialog(r, "Done");
      await accepts("leadership", V.lead2);
      assert.equal((await H.rawVault()).locks.length, 1);
      await finish(r);
    });

    it("7 a 6-minute pause before Save: the Leadership change completes; the page's own account is signed in again right before its update", T, async () => {
      await H.reset(); await H.seedVault(CUR);
      const p = await signedIn(V.lead, { clock: true });
      await p.clock.fastForward("06:00");
      p.__log.auth.length = 0;
      await H.changeRole(p, "leadership", V.lead2);
      await H.waitDialog(p, "Done");
      const calls = p.__log.auth;
      const iUpd = calls.findIndex((c) => c.op === "update" && c.email === ADMIN);
      assert.ok(iUpd > 0, "no update of the page's own account");
      const signIns = calls.slice(0, iUpd).filter((c) => c.op === "signInWithPassword");
      assert.equal(signIns[signIns.length - 1].email, ADMIN, "the last sign-in before the update is not the page's own account");
      await accepts("leadership", V.lead2);
      await finish(p);
    });

    it("8 stale: one ED account changed elsewhere; type the one in use; they differ, Change opens; Save; both new; no trace", T, async () => {
      await H.reset(); await H.seedVault(CUR);
      await H.setPassword("voting:ed", V.console);
      const p = await signedIn();
      assert.ok((await H.rowText(p, "ed")).includes(staleText("voting:ed")));
      await H.rowButton(p, "ed", "stale").click();
      await H.waitDialog(p, "The ED password in use");
      await p.fill("#pwTyped", V.wrong[0]);
      await H.dialogClick(p, "Check");
      await p.waitForFunction((t) => document.querySelector("#pwErr").textContent === t, TEXT.typedWrong);
      await p.fill("#pwTyped", V.console);
      await H.dialogClick(p, "Check");
      await H.waitDialog(p, "New ED password");
      assert.ok((await H.dialogText(p)).includes(differText("ed", {})));
      await H.saveNew(p, V.ed2);
      await H.waitDialog(p, "Done");
      await accepts("ed", V.ed2);
      const o = await H.openRaw(V.lead);
      assert.equal(o.content.roles.ed, V.ed2);
      assert.ok(!JSON.stringify(o.content).includes(V.console), "the old value is still in the vault");
      await finish(p);
    });

    it("8b stale: both ED accounts changed to the same value: one write, Show shows it", T, async () => {
      await H.reset(); await H.seedVault(CUR);
      await H.setPassword("voting:ed", V.same); await H.setPassword("hiring:committee", V.same);
      const p = await signedIn();
      const gen = (await H.rawVault()).gen;
      await H.rowButton(p, "ed", "stale").click();
      await H.waitDialog(p, "The ED password in use");
      await p.fill("#pwTyped", V.same);
      await H.dialogClick(p, "Check");
      await H.waitDialog(p, "Saved");
      assert.ok((await H.dialogText(p)).includes(TEXT.savedStale));
      await H.dialogClick(p, "Close");
      assert.equal((await H.rawVault()).gen, gen + 1);
      await H.rowButton(p, "ed", "show").click();
      assert.equal(await valueOf(p, "ed"), V.same);
      await finish(p);
    });

    it("8c stale: the typed value equals another role's: not saved, Change opens; Cancel keeps the row's warning", T, async () => {
      await H.reset(); await H.seedVault(CUR);
      await H.setPassword("hiring:applicant", V.ed);
      const p = await signedIn();
      const gen = (await H.rawVault()).gen;
      await H.rowButton(p, "guest", "stale").click();
      await H.waitDialog(p, "The Guest password in use");
      await p.fill("#pwTyped", V.ed);
      await H.dialogClick(p, "Check");
      await H.waitDialog(p, "New Guest password");
      assert.ok((await H.dialogText(p)).includes(sameAsText("guest", "ed")));
      assert.equal((await H.rawVault()).gen, gen, "saved a value equal to another role's");
      await H.dialogClick(p, "Cancel");
      assert.ok((await H.rowText(p, "guest")).includes(staleRowText("guest")));
      await finish(p);
    });

    it("9 can't finish: an account switched off part way is named with the console step; no Cancel; Finish after switching it on", T, async () => {
      await H.reset(); await H.seedVault(CUR);
      const p = await signedIn();
      let done = false;
      p.__intercept = async (route, req) => {
        if (!done && req.url().includes("accounts:update") && H.callOf(req).email === H.emailOf("voting:ed")) { done = true; await H.setDisabled("hiring:committee", true); }
        return false;
      };
      await H.changeRole(p, "ed", V.ed2);
      await H.waitDialog(p, "Not finished");
      // (the test copy's project id is the demo one)
      const want = failureText({ code: "auth/user-disabled" }, "hiring:committee").replace("project mgh-ed-hiring", `project ${"demo-mgh-ed-admin"}`);
      assert.ok((await H.dialogText(p)).includes(want), await H.dialogText(p));
      await H.dialogClick(p, "Close");
      assert.equal(await H.rowButton(p, "ed", "cancel").count(), 0, "Cancel offered after an account changed");
      await H.setDisabled("hiring:committee", false);
      await finishFromRow(p, "ed", V.ed2);
      await H.waitDialog(p, "Done");
      await accepts("ed", V.ed2);
      await finish(p);
    });

    it("10 recovery: a vault locked with another Leadership value; a new copy is made", T, async () => {
      await H.reset(); await H.seedVault(CUR, { lockPassword: V.other });
      const p = await open();
      await H.signIn(p, V.lead);
      await p.waitForSelector("#fuEd", { timeout: 30000 });
      assert.ok((await p.textContent("#app")).includes(TEXT.recovery));
      await p.fill("#fuEd", V.ed); await p.fill("#fuGuest", V.guest);
      await p.click("#fuGo");
      await H.onMain(p);
      const raw = await H.rawVault();
      assert.equal(raw.gen, 2);
      assert.deepEqual((await H.openRaw(V.lead)).content.roles, CUR);
      assert.equal(await H.openRaw(V.other), null);
      await finish(p);
    });

    it("11 two devices: the other's Save gets changed-elsewhere, reloads and shows the latest", T, async () => {
      await H.reset(); await H.seedVault(CUR);
      const a = await signedIn(), b = await signedIn();
      await H.changeRole(a, "guest", V.guest2);
      await H.waitDialog(a, "Done");
      await H.dialogClick(a, "Close");
      await H.changeRole(b, "ed", V.ed2);
      await H.waitDialog(b, "Changed on another device");
      assert.ok((await H.dialogText(b)).includes(TEXT.changedElsewhere));
      await H.dialogClick(b, "Close");
      await H.rowButton(b, "guest", "show").click();
      assert.equal(await valueOf(b, "guest"), V.guest2);
      await accepts("ed", V.ed);
      await finish(a); await finish(b);
    });

    it("12 gate: 3 wrong, then 30 s; the ED password is refused; idle 10 minutes and 5 minutes hidden sign out", T, async () => {
      await H.reset(); await H.seedVault(CUR);
      const p = await open({ clock: true });
      for (let i = 0; i < 3; i++) {
        await H.signIn(p, V.wrong[i]);
        await waitGate(p, /Incorrect password/);
        await p.waitForFunction(() => !document.querySelector("#gbtn").textContent.includes("Signing in"));
      }
      assert.equal(await H.gateText(p), gateWrongText(true));
      assert.match(await p.textContent("#gbtn"), /^Wait \d+ s$/);
      assert.equal(await p.isDisabled("#gbtn"), true);
      await p.clock.fastForward(31000);
      await p.waitForFunction(() => document.querySelector("#gbtn").textContent === "Enter" && !document.querySelector("#gbtn").disabled);
      await H.signIn(p, V.ed);
      await p.waitForFunction((t) => document.querySelector("#gerr").textContent === t, gateWrongText(false), { timeout: 30000 });
      await H.signIn(p, V.lead);
      await H.onMain(p);
      assert.deepEqual(await H.leaks(p), []);
      await p.clock.fastForward("10:30");
      await p.waitForFunction((t) => document.querySelector("#gerr") && document.querySelector("#gerr").textContent === t, TEXT.idleOut, { timeout: 30000 });
      assert.equal(await p.isVisible("#gate"), true);
      await H.signIn(p, V.lead);
      await H.onMain(p);
      await p.evaluate(() => window.__setHidden(true));
      await p.clock.fastForward("05:10");
      await p.waitForFunction((t) => document.querySelector("#gerr") && document.querySelector("#gerr").textContent === t, TEXT.hiddenOut, { timeout: 30000 });
      await finish(p);
    });

    it("r3 another device changes ED while this tab remembers ED's old values: Change here says changed elsewhere, drops the old mark, then saves", T, async () => {
      await H.reset();
      await H.setPassword("hiring:admin", V.other);
      await H.setPassword("hiring:committee", V.console);
      // tab A: first use finds both roles differ; the first Change is cancelled
      const a = await open();
      await H.signIn(a, V.lead);
      await a.waitForSelector("#fuEd", { timeout: 30000 });
      await a.fill("#fuEd", V.ed); await a.fill("#fuGuest", V.guest); await a.click("#fuGo");
      await H.waitDialog(a, "The Admin password in use");
      await a.fill("#pwTyped", V.other); await a.press("#pwTyped", "Enter");
      await H.waitDialog(a, "The ED password in use");
      await a.fill("#pwTyped", V.console); await a.press("#pwTyped", "Enter");
      await H.waitDialog(a, "New Admin password");
      await H.dialogClick(a, "Cancel");
      await H.onMain(a);
      assert.ok((await H.rowText(a, "ed")).includes(staleRowText("ed")));
      // device B: types the values in use, then changes ED
      const b = await signedIn();
      await H.rowButton(b, "leadership", "stale").click();
      await H.waitDialog(b, "The Admin password in use");
      await b.fill("#pwTyped", V.other); await b.press("#pwTyped", "Enter");
      await H.waitDialog(b, "New Admin password");
      await H.dialogClick(b, "Cancel");
      await H.rowButton(b, "ed", "stale").click();
      await H.waitDialog(b, "The ED password in use");
      await b.fill("#pwTyped", V.console); await b.press("#pwTyped", "Enter");
      await H.waitDialog(b, "New ED password");
      await H.saveNew(b, V.ed2);
      await H.waitDialog(b, "Done", 90000);
      await accepts("ed", V.ed2);
      await finish(b);
      // tab A: the Leadership change finds the copy moved
      await H.rowButton(a, "leadership", "change").click();
      await H.waitDialog(a, "New Admin password");
      await H.saveNew(a, V.lead2);
      await H.waitDialog(a, "Changed on another device", 90000);
      await H.dialogClick(a, "Close");
      await H.onMain(a);
      assert.ok(!(await H.rowText(a, "ed")).includes(staleRowText("ed")), "the ED row still says the tools disagree");
      assert.ok(!(await H.rowText(a, "ed")).includes("doesn't accept"));
      await H.rowButton(a, "leadership", "change").click();
      await H.waitDialog(a, "New Admin password");
      await H.saveNew(a, V.lead2);
      await H.waitDialog(a, "Done", 90000);
      await accepts("leadership", V.lead2);
      await accepts("ed", V.ed2);
      await finish(a);
    });

    it("r2 first use with two roles whose hiring accounts differ: save the Leadership change, then the ED one", T, async () => {
      await H.reset();
      await H.setPassword("hiring:admin", V.other);
      await H.setPassword("hiring:committee", V.console);
      const p = await open();
      await H.signIn(p, V.lead);
      await p.waitForSelector("#fuEd", { timeout: 30000 });
      await p.fill("#fuEd", V.ed); await p.fill("#fuGuest", V.guest); await p.click("#fuGo");
      await H.waitDialog(p, "The Admin password in use");
      await p.fill("#pwTyped", V.other); await p.press("#pwTyped", "Enter");
      await H.waitDialog(p, "The ED password in use");
      await p.fill("#pwTyped", V.console); await p.press("#pwTyped", "Enter");
      await H.waitDialog(p, "New Admin password");
      await H.saveNew(p, V.lead2);
      await H.waitDialog(p, "Done", 90000);
      await H.dialogClick(p, "Close");
      await accepts("leadership", V.lead2);
      assert.equal(await H.rowButton(p, "ed", "change").textContent(), "Set a new ED password");
      await H.rowButton(p, "ed", "change").click();
      await H.waitDialog(p, "New ED password");
      await H.saveNew(p, V.ed2);
      await H.waitDialog(p, "Done", 90000);
      await accepts("ed", V.ed2);
      await finish(p);
    });

    it("r2 progress reads out each account as it changes, not the whole step each time", T, async () => {
      await H.reset(); await H.seedVault(CUR);
      const p = await signedIn();
      await H.rowButton(p, "ed", "change").click();
      await H.waitDialog(p, "New ED password");
      await p.evaluate(() => {
        window.__live = [];
        const el = document.querySelector("#flowLive");
        new MutationObserver(() => { if (el.textContent) window.__live.push(el.textContent); }).observe(el, { childList: true, characterData: true, subtree: true });
      });
      await H.saveNew(p, V.ed2);
      await H.waitDialog(p, "Done");
      await p.waitForFunction(() => window.__live.some((t) => t.startsWith("Done")));
      const live = await p.evaluate(() => window.__live);
      assert.equal(live.filter((t) => t.startsWith("Changing the ED password")).length, 1, JSON.stringify(live));
      assert.ok(live.includes("Motion Voting, ED account: changed"), JSON.stringify(live));
      assert.ok(live.includes("Physician Hiring, ED account: changed"), JSON.stringify(live));
      await finish(p);
    });

    it("r2 the Finish preview hides again after 30 s", T, async () => {
      await H.reset(); await H.seedVault(CUR);
      const p = await signedIn();
      dropUpdateOf(p, "hiring:committee");
      await H.changeRole(p, "ed", V.ed2);
      await H.waitDialog(p, "Not finished");
      await finish(p, { allowConsole: ABORTED });
      const q = await signedIn(V.lead, { clock: true });
      await H.rowButton(q, "ed", "finish").click();
      await H.waitDialog(q, "Finish the change");
      await q.click("#finShow");
      assert.equal(await q.textContent("#finVal"), V.ed2);
      await q.clock.fastForward(31000);
      assert.equal(await q.$eval("#finVal [aria-hidden]", (e) => e.textContent), DOTS);
      assert.equal(await q.textContent("#finShow"), "Show");
      await H.dialogClick(q, "Close");
      await finish(q);
    });

    it("r2 before Go on, an account taking neither value says to press Go on, with no field to type into", T, async () => {
      await H.reset(); await H.seedVault(CUR);
      const p = await signedIn();
      dropCommitsAfter(p, 1);
      await H.changeRole(p, "leadership", V.lead2);
      await H.waitDialog(p, "Not finished", 120000);
      await finish(p, { allowConsole: ABORTED });
      await H.setPassword("voting:leadership", V.console);
      const q = await signedIn(V.lead);
      const t = await H.rowText(q, "leadership");
      assert.ok(t.includes("Motion Voting's Admin account doesn't accept the saved password or the new one. Someone may have changed it another way. Press Go on first."), t);
      assert.equal(await H.rowButton(q, "leadership", "fix").count(), 0);
      assert.equal(await H.rowButton(q, "leadership", "finish").textContent(), "Go on");
      await finish(q);
    });

    it("r1 Return: moves to the next field, then presses the main button (first use and Change); each step is read out", T, async () => {
      await H.reset();
      const p = await open();
      await H.signIn(p, V.lead);
      await p.waitForSelector("#fuEd", { timeout: 30000 });
      await p.fill("#fuEd", V.ed);
      await p.press("#fuEd", "Enter");
      assert.equal(await p.evaluate(() => document.activeElement.id), "fuGuest");
      await p.fill("#fuGuest", V.guest);
      await p.press("#fuGuest", "Enter");
      await H.onMain(p);
      await H.rowButton(p, "ed", "change").click();
      await H.waitDialog(p, "New ED password");
      assert.equal(await p.getAttribute("#pwNew", "enterkeyhint"), "next");
      assert.equal(await p.getAttribute("#pwRep", "enterkeyhint"), "go");
      await p.evaluate(() => {
        window.__live = [];
        const el = document.querySelector("#flowLive");
        new MutationObserver(() => { if (el.textContent) window.__live.push(el.textContent); }).observe(el, { childList: true, characterData: true, subtree: true });
      });
      await p.fill("#pwNew", V.ed2);
      await p.press("#pwNew", "Enter");
      assert.equal(await p.evaluate(() => document.activeElement.id), "pwRep");
      await p.fill("#pwRep", V.ed2);
      await p.press("#pwRep", "Enter");
      await H.waitDialog(p, "Done");
      await p.waitForFunction(() => window.__live.some((t) => t.startsWith("Done")));
      const live = await p.evaluate(() => window.__live);
      assert.ok(live.some((t) => t.startsWith("Changing the ED password")), "the progress was not read out");
      assert.equal(await p.$eval("#flowLive", (e) => e.getAttribute("role")), "status");
      await accepts("ed", V.ed2);
      await finish(p);
    });

    it("r1 pending role: an account that takes neither value is on the Finish line; Type the one in use with Return finishes", T, async () => {
      await H.reset(); await H.seedVault(CUR);
      const p = await signedIn();
      dropUpdateOf(p, "hiring:committee");
      await H.changeRole(p, "ed", V.ed2);
      await H.waitDialog(p, "Not finished");
      await finish(p, { allowConsole: ABORTED });
      await H.setPassword("hiring:committee", V.console);
      const q = await signedIn();
      assert.ok((await H.rowText(q, "ed")).includes(failureText({ code: "refused" }, "hiring:committee")));
      await H.rowButton(q, "ed", "fix").click();
      await H.waitDialog(q, "Not finished");
      await q.fill("#pwFix", V.console);
      await q.press("#pwFix", "Enter");
      await H.waitDialog(q, "Done");
      await accepts("ed", V.ed2);
      await finish(q);
    });

    it("r1 another role's change pending: a stale row says to finish that first, with no Type the one in use", T, async () => {
      await H.reset(); await H.seedVault(CUR);
      const p = await signedIn();
      dropUpdateOf(p, "hiring:applicant");
      await H.changeRole(p, "guest", V.guest2);
      await H.waitDialog(p, "Not finished");
      await finish(p, { allowConsole: ABORTED });
      await H.setPassword("voting:ed", V.console);
      const q = await signedIn();
      const t = await H.rowText(q, "ed");
      assert.ok(t.includes(staleText("voting:ed")));
      assert.ok(t.includes(blockedBy({ pending: { role: "guest" } }, "ed")));
      assert.equal(await H.rowButton(q, "ed", "stale").count(), 0);
      await finish(q);
    });

    it("r1 first use: two roles not the same everywhere: both rows marked, the first Change opens, Cancel keeps both", T, async () => {
      await H.reset();
      await H.setPassword("voting:leadership", V.other);
      await H.setPassword("voting:ed", V.console);
      const p = await open();
      await H.signIn(p, V.lead);
      await p.waitForSelector("#fuEd", { timeout: 30000 });
      await p.fill("#fuEd", V.ed); await p.fill("#fuGuest", V.guest); await p.click("#fuGo");
      await H.waitDialog(p, "The Admin password in use");
      await p.fill("#pwTyped", V.other);
      await p.press("#pwTyped", "Enter");
      await H.waitDialog(p, "The ED password in use");
      await p.fill("#pwTyped", V.console);
      await p.press("#pwTyped", "Enter");
      await H.waitDialog(p, "New Admin password");
      assert.ok((await H.dialogText(p)).includes(differText("leadership", {})));
      await H.dialogClick(p, "Cancel");
      await H.onMain(p);
      assert.ok((await H.rowText(p, "leadership")).includes(staleRowText("leadership")));
      assert.ok((await H.rowText(p, "ed")).includes(staleRowText("ed")));
      assert.equal(await H.rowButton(p, "ed", "change").isDisabled(), false);
      assert.equal(await H.rowButton(p, "ed", "change").textContent(), "Set a new ED password");
      await finish(p);
    });

    it("r1 first use: cancelling the follow-up dialog clears Checking", T, async () => {
      await H.reset();
      await H.setPassword("voting:ed", V.console);
      const p = await open();
      await H.signIn(p, V.lead);
      await p.waitForSelector("#fuEd", { timeout: 30000 });
      await p.fill("#fuEd", V.ed); await p.fill("#fuGuest", V.guest); await p.click("#fuGo");
      await H.waitDialog(p, "The ED password in use");
      await H.dialogClick(p, "Cancel");
      assert.equal(await p.textContent("#fuErr"), "");
      await finish(p);
    });

    it("r1 hidden tab resets shown fields; a blocked Copy says so in the row; a page from the back/forward cache starts again", T, async () => {
      await H.reset(); await H.seedVault(CUR);
      const p = await signedIn();
      await H.rowButton(p, "ed", "change").click();
      await H.waitDialog(p, "New ED password");
      await p.fill("#pwNew", V.ed2);
      await p.click('button[data-show="pwNew"]');
      assert.equal(await p.getAttribute("#pwNew", "type"), "text");
      await p.evaluate(() => window.__setHidden(true));
      assert.equal(await p.getAttribute("#pwNew", "type"), "password");
      assert.equal(await p.textContent('button[data-show="pwNew"]'), "Show");
      await p.evaluate(() => window.__setHidden(false));
      await H.dialogClick(p, "Cancel");
      await p.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("blocked")) } }));
      await H.rowButton(p, "guest", "copy").click();
      await p.waitForSelector("#copyNote-guest:not([hidden])");
      assert.match(await p.textContent("#copyNote-guest"), /didn't let the page copy it/);
      assert.equal(await p.evaluate(() => String(getSelection())), V.guest);
      await p.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
      await p.waitForFunction(() => window.__edReady === true && !document.querySelector("#gate").hidden && document.querySelector("#app").hidden, null, { timeout: 20000 });
      await finish(p);
    });

    it("r1 in a frame with boot.js blocked, the page module still refuses to start", T, async () => {
      const f = await open();
      await f.route("**/passwords/boot.js*", (r) => r.abort());
      await f.goto(`${H.BASE}/frame.html`);
      const frame = f.frames().find((x) => x.url().endsWith("/passwords.html"));
      await frame.waitForLoadState("load");
      await f.waitForTimeout(1500);
      assert.notEqual(await frame.evaluate(() => window.__edReady), true);
      await H.closePage(f);
    });

    for (const scheme of ["light", "dark"]) {
      it(`13 page rules (${scheme}): refuses in a frame; no policy violation; no sideways scroll; 44 px buttons, 16 px fields; a failed Save's message on top`, T, async () => {
        await H.reset(); await H.seedVault(CUR);
        const f = await open({ scheme });
        await f.goto(`${H.BASE}/frame.html`);
        const frame = f.frames().find((x) => x.url().endsWith("/passwords.html"));
        await frame.waitForSelector(".pw-framed", { timeout: 15000 });
        assert.equal(await frame.textContent(".pw-framed"), TEXT.frame);
        assert.equal(await frame.$("#gate"), null);
        await H.closePage(f);
        const p = await open({ scheme });
        const sizes = () => p.evaluate(() => {
          const bad = [];
          for (const b of document.querySelectorAll("button, input, textarea")) {
            const r = b.getBoundingClientRect(); if (!r.width) continue;
            if (b.tagName === "BUTTON" && r.height < 44) bad.push(`${b.textContent} ${Math.round(r.height)}px tall`);
            if (b.tagName !== "BUTTON" && parseFloat(getComputedStyle(b).fontSize) < 16) bad.push(`${b.id} text ${getComputedStyle(b).fontSize}`);
            // nothing remembered or corrected (round 1 m6)
            if (b.tagName === "INPUT" && !(b.getAttribute("autocomplete") === "off" && b.getAttribute("autocorrect") === "off"
              && b.getAttribute("autocapitalize") === "off" && b.getAttribute("spellcheck") === "false")) bad.push(`${b.id} may be remembered or corrected`);
          }
          return bad;
        });
        assert.equal(await H.noSidewaysScroll(p), true, "gate scrolls sideways");
        assert.deepEqual(await sizes(), []);
        await H.signIn(p, V.lead); await H.onMain(p);
        for (const r of ["leadership", "ed", "guest"]) await H.rowButton(p, r, "show").click();
        assert.equal(await H.noSidewaysScroll(p), true, "main view scrolls sideways");
        assert.deepEqual(await sizes(), []);
        await H.rowButton(p, "ed", "change").click();
        await H.waitDialog(p, "New ED password");
        assert.equal(await H.noSidewaysScroll(p), true, "dialog scrolls sideways");
        assert.deepEqual(await sizes(), []);
        await H.saveNew(p, V.ed2, V.ed2 + "x");
        const m = await p.evaluate(() => {
          const e = document.querySelector("#pwErr"), r = e.getBoundingClientRect();
          return { text: e.textContent, topHalf: r.top >= 0 && r.bottom <= window.innerHeight / 2, invalid: document.querySelector("#pwRep").getAttribute("aria-invalid"),
            focus: (document.activeElement || {}).id || (document.activeElement || {}).tagName };
        });
        assert.match(m.text, /don't match/);
        assert.equal(m.topHalf, true, "the message is not in the top half");
        assert.equal(m.invalid, "true");
        if (kind === "webkit") assert.notEqual(m.focus, "pwRep", "a touch screen focused the field");
        else assert.equal(m.focus, "pwRep");
        await H.dialogClick(p, "Cancel");
        await finish(p);
      });

      it(`14 axe (${scheme}): gate, first use, main view, Change, progress, Done, and Type the one in use`, T, async () => {
        await H.reset();
        let p = await open({ scheme });
        const axe = async (where) => {
          await p.evaluate(AXE);
          const v = await p.evaluate(async (tags) => {
            const r = await window.axe.run(document, { runOnly: { type: "tag", values: tags } });
            return r.violations.map((x) => `${x.id} (${x.impact}): ${x.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`);
          }, AXE_TAGS);
          assert.deepEqual(v, [], `${where}: ${v.join(" | ")}`);
        };
        await axe("gate");
        await H.signIn(p, V.lead);
        await p.waitForSelector("#fuEd", { timeout: 30000 });
        await axe("first use");
        await p.fill("#fuEd", V.ed); await p.fill("#fuGuest", V.guest); await p.click("#fuGo");
        await H.onMain(p);
        await axe("main view");
        await H.rowButton(p, "ed", "change").click();
        await H.waitDialog(p, "New ED password");
        await axe("Change dialog");
        // hold the first account's update so the progress step stays on screen
        let release; const held = new Promise((r) => { release = r; });
        let holding = false;
        p.__intercept = async (route, req) => {
          if (holding || !req.url().includes("accounts:update")) return false;
          holding = true; await held; return false;
        };
        await H.saveNew(p, V.ed2);
        await H.waitDialog(p, "Changing the ED password");
        await p.waitForFunction(() => document.querySelector(".pw-steps .is-now"));
        await axe("progress");
        release();
        await H.waitDialog(p, "Done");
        await axe("Done");
        await H.dialogClick(p, "Close");
        await H.closePage(p);
        await H.setPassword("voting:ed", V.console);
        p = await signedIn(V.lead, { scheme });
        await H.rowButton(p, "ed", "stale").click();
        await H.waitDialog(p, "The ED password in use");
        await axe("Type the one in use");
        await H.dialogClick(p, "Cancel");
        await finish(p);
      });
    }
  });
}
