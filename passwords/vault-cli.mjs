#!/usr/bin/env node
// ============================================================================
//  vault-cli.mjs: seal and check the vault from the terminal, for the
//  workspace script set-passwords.py (design B.7.3). Node 20+, no packages.
//
//  One JSON object on stdin (never the command line, which other programs on
//  the computer can see), one JSON object on stdout. Nothing ever printed
//  holds a password or a decrypted value; errors are short fixed messages on
//  stderr; exit 1 on any problem.
//
//    node vault-cli.mjs seal
//      in:  { "password": str, "content": { "roles": { leadership, ed, guest },
//             "pending": null, "changedAt": { ... } }, "gen": int }
//      out: { "v": 1, "gen": gen, "locks": [ { salt, iter, iv, ct } ] }
//           (one lock with a fresh salt; content.v and content.gen are set
//           here and the content is padded)
//
//    node vault-cli.mjs check
//      in:  { "password": str, "doc": { v, gen, locks }, "expect": { "roles": { ... } } }
//      out: { "ok": bool, "opened": bool, "gen": int, "rolesMatch": bool, "pending": bool }
//           exit 1 unless ok (opened and rolesMatch)
// ============================================================================
import { makeLock, seal, openVault } from "./vault.js";

const ROLES = ["leadership", "ed", "guest"];

function stop(message) {
  process.stderr.write(`vault-cli: ${message}\n`);
  process.exit(1);
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

const isRoles = (r) => !!r && typeof r === "object" && ROLES.every((k) => typeof r[k] === "string" && r[k].length > 0);

async function sealCmd(input) {
  const { password, content, gen } = input;
  if (typeof password !== "string" || !password) stop("seal needs a password");
  if (!content || typeof content !== "object" || !isRoles(content.roles)) stop("seal needs content.roles with leadership, ed and guest");
  if (!Number.isInteger(gen) || gen < 1) stop("seal needs gen, a whole number of 1 or more");
  const body = { roles: { leadership: content.roles.leadership, ed: content.roles.ed, guest: content.roles.guest },
    pending: content.pending === undefined ? null : content.pending,
    changedAt: content.changedAt && typeof content.changedAt === "object" ? content.changedAt : {} };
  const lock = await makeLock(password);
  const locks = await seal(body, [lock], gen);
  return { out: { v: 1, gen, locks }, code: 0 };
}

async function checkCmd(input) {
  const { password, doc, expect } = input;
  if (typeof password !== "string" || !password) stop("check needs a password");
  if (!doc || typeof doc !== "object") stop("check needs doc");
  if (!expect || !isRoles(expect.roles)) stop("check needs expect.roles with leadership, ed and guest");
  let opened = null;
  try { opened = await openVault(doc, password); } catch { opened = null; }
  const roles = opened && opened.content && opened.content.roles;
  const rolesMatch = !!roles && ROLES.every((k) => roles[k] === expect.roles[k]);
  const out = { ok: !!opened && rolesMatch, opened: !!opened, gen: Number.isInteger(doc.gen) ? doc.gen : 0,
    rolesMatch, pending: !!(opened && opened.content.pending) };
  return { out, code: out.ok ? 0 : 1 };
}

async function main() {
  const cmd = process.argv[2];
  if (cmd !== "seal" && cmd !== "check") stop("use: node vault-cli.mjs seal|check (JSON on stdin)");
  if (process.argv.length > 3) stop("nothing goes on the command line; send JSON on stdin");
  let input;
  try { input = JSON.parse(await readStdin()); } catch { stop("stdin is not one JSON object"); }
  if (!input || typeof input !== "object" || Array.isArray(input)) stop("stdin is not one JSON object");
  let res;
  try { res = cmd === "seal" ? await sealCmd(input) : await checkCmd(input); }
  catch { stop(`${cmd} failed`); }
  process.stdout.write(JSON.stringify(res.out) + "\n");
  process.exitCode = res.code;
}

// any surprise ends with a fixed message, never a stack (it could hold a value)
process.on("uncaughtException", () => stop("failed"));
process.on("unhandledRejection", () => stop("failed"));
main().catch(() => stop("failed"));
