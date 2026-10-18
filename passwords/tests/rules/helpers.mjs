// Shared by the emulator tests. The rules copy gets a test uid in place of
// the placeholder (the published file gets the real one, B.2.2 D). The
// emulator runs as project demo-mgh-ed-admin: a demo- project never talks
// to a real one.
import { readFileSync } from "node:fs";
import { testRules } from "../make-site.mjs";

export const PROJECT = "demo-mgh-ed-admin";
export { TEST_UID } from "../make-site.mjs";
export const ADMIN_EMAIL = "leadership@mgh-ed-admin.invalid";
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8086").split(":");
export const EMU = { host, port: Number(port) };
// by pattern: works with the placeholder and with the real uid (round 1 D-M1)
export const rulesForTest = () => testRules(readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"));
// a password sign-in with this email (token options for authenticatedContext)
export const pw = (email) => ({ email, firebase: { sign_in_provider: "password" } });
