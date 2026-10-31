import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MONARCH_TENANT_ID, pickTenant } from "../lib/tenants.ts";
import { chooseWorkspace, WORKSPACES_OPEN_TO_ALL_TENANTS } from "../lib/workspace-tenant.ts";

// Un-hardwiring Monarch, step 1: the tenant comes from the signed-in person's memberships, and the foundation is in place
// without changing what anyone sees today.

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";

describe("which tenant a request acts for", () => {
  test("a resolved tenant wins; invalid ids are refused", () => {
    assert.equal(pickTenant(A, false), A);
    assert.equal(pickTenant(A, true), A);
    assert.throws(() => pickTenant("monarch", false), /tenant id is required/);
  });

  test("loose mode (today) keeps acting for Monarch when nothing was resolved; strict mode refuses instead of guessing Monarch", () => {
    assert.equal(pickTenant(null, false), MONARCH_TENANT_ID);
    assert.equal(pickTenant(undefined, false), MONARCH_TENANT_ID);
    assert.throws(() => pickTenant(null, true), /No workspace is resolved/);
  });
});

describe("which workspace a person opens", () => {
  test("only owners and admins open a workspace; staff and strangers do not", () => {
    assert.equal(chooseWorkspace({ platformAdmin: false, memberships: [], openToAll: true }), null);
    assert.equal(chooseWorkspace({ platformAdmin: false, memberships: [{ tenant_id: A, role: "staff" }], openToAll: true }), null);
    assert.deepEqual(chooseWorkspace({ platformAdmin: false, memberships: [{ tenant_id: A, role: "owner" }], openToAll: true }), { tenantId: A, role: "owner" });
    assert.deepEqual(chooseWorkspace({ platformAdmin: false, memberships: [{ tenant_id: B, role: "admin" }], openToAll: true }), { tenantId: B, role: "admin" });
  });

  test("a platform administrator with no membership of their own keeps opening Monarch's workspace", () => {
    assert.deepEqual(chooseWorkspace({ platformAdmin: true, memberships: [] }), { tenantId: MONARCH_TENANT_ID, role: "admin" });
  });

  test("with several memberships Monarch's comes first, then the lowest tenant id: never the order the rows arrived in", () => {
    const rows = [{ tenant_id: B, role: "owner" }, { tenant_id: A, role: "owner" }];
    assert.equal(chooseWorkspace({ platformAdmin: false, memberships: rows, openToAll: true })!.tenantId, A);
    assert.equal(chooseWorkspace({ platformAdmin: false, memberships: [...rows].reverse(), openToAll: true })!.tenantId, A);
    const withMonarch = [...rows, { tenant_id: MONARCH_TENANT_ID, role: "admin" }];
    assert.equal(chooseWorkspace({ platformAdmin: false, memberships: withMonarch, openToAll: true })!.tenantId, MONARCH_TENANT_ID);
  });

  test("until the workspace is opened to every tenant, only Monarch's memberships count (nobody else gets in)", () => {
    assert.equal(WORKSPACES_OPEN_TO_ALL_TENANTS, false);
    assert.equal(chooseWorkspace({ platformAdmin: false, memberships: [{ tenant_id: A, role: "owner" }] }), null);
    assert.deepEqual(chooseWorkspace({ platformAdmin: false, memberships: [{ tenant_id: A, role: "owner" }, { tenant_id: MONARCH_TENANT_ID, role: "admin" }] }), { tenantId: MONARCH_TENANT_ID, role: "admin" });
  });
});

describe("the two switches move together", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  test("the workspace is not opened to other tenants unless unresolved requests are errors, not Monarch", () => {
    const open = /WORKSPACES_OPEN_TO_ALL_TENANTS = true/.test(read("lib/workspace-tenant.ts"));
    const strict = /TENANT_STRICT = true/.test(read("lib/tenants.ts"));
    assert.equal(open && !strict, false, "opening the workspace needs TENANT_STRICT on in the same change");
  });

  test("requireAdmin remembers the tenant it worked out from the person's memberships, for this request only", () => {
    const admin = read("lib/admin.ts");
    assert.match(admin, /chooseWorkspace\(\{ platformAdmin:/);
    assert.match(admin, /rememberWorkspaceTenant\(workspace\.tenantId\)/);
    assert.match(read("lib/workspace-session.ts"), /cache\(\(\) => \(\{ tenantId: null/);
  });
});

describe("the old Monarch default may not spread", () => {
  // A ratchet: the count of currentTenantId() calls can only go down as the workspace moves to the resolved tenant.
  const BASELINE = 90; // this release carries the foundation only; later pieces move more calls to the resolved tenant and lower it
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : files(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }
  test(`no more than ${BASELINE} calls to currentTenantId() across app, lib and components`, () => {
    const root = new URL("..", import.meta.url).pathname;
    const count = ["app", "lib", "components"].flatMap((d) => files(join(root, d))).reduce((n, f) => n + (readFileSync(f, "utf8").match(/currentTenantId\(\)/g)?.length ?? 0), 0);
    assert.ok(count <= BASELINE, `currentTenantId() is called ${count} times; the limit is ${BASELINE}. Use the resolved workspace tenant, or MONARCH_TENANT_ID where the code is deliberately Monarch's.`);
  });
});
