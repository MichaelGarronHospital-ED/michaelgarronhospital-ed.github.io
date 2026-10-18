// Shared by the emulator tests. The rules copy gets a test uid in place of
// the placeholder (the published file gets the real one, B.2.2 D). The
// emulator runs as project demo-mgh-ed-admin: a demo- project never talks
// to a real one.
import { readFileSync } from "node:fs";

export const PROJECT = "demo-mgh-ed-admin";
export const TEST_UID = "TestAdminUid000000000000001";
export const ADMIN_EMAIL = "leadership@mgh-ed-admin.invalid";
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8086").split(":");
export const EMU = { host, port: Number(port) };
export const rulesForTest = () => {
  const src = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
  if (!src.includes("'ADMIN_UID_NOT_SET'")) throw new Error("the rules have no placeholder to replace");
  return src.replace("'ADMIN_UID_NOT_SET'", `'${TEST_UID}'`);
};
// a password sign-in with this email (token options for authenticatedContext)
export const pw = (email) => ({ email, firebase: { sign_in_provider: "password" } });
