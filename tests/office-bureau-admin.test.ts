import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The office area must open for the people who run the bureau: platform administrators and owners/admins of the Monarch
// workspace. Opening an office from Office access used to bounce an owner who was not on the platform administrator list.
describe("office area bureau access", () => {
  const office = readFileSync(new URL("../lib/office/server.ts", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../lib/admin.ts", import.meta.url), "utf8");

  test("requireOffice lets a workspace owner or admin open any office", () => {
    assert.match(office, /if \(await isBureauAdmin\(user\.id\)\)/);
    assert.doesNotMatch(office, /if \(await isAdminUser\(user\.id\)\)/);
  });

  test("a bureau administrator is a platform administrator or a workspace owner/admin, and nobody else", () => {
    assert.match(admin, /export async function isBureauAdmin[\s\S]{0,200}isAdminUser\(userId\)\) \|\| \(await isMonarchMember\(userId\)/);
    assert.match(admin, /return roleOpensWorkspace\(/, "staff-role members still do not open the workspace");
  });
});
