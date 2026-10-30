import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MONARCH_TENANT_ID, pickTenant } from "../lib/tenants.ts";
import { chooseWorkspace, workspacesOpenToAll } from "../lib/workspace-tenant.ts";

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

  test("production stays closed: only Monarch's memberships count there (nobody else gets in); Preview opens to every tenant", () => {
    assert.equal(workspacesOpenToAll({ VERCEL_ENV: "production" }), false);
    assert.equal(workspacesOpenToAll({}), false);
    assert.equal(workspacesOpenToAll({ VERCEL_ENV: "preview" }), true);
    assert.equal(chooseWorkspace({ platformAdmin: false, memberships: [{ tenant_id: A, role: "owner" }], openToAll: false }), null);
    assert.deepEqual(chooseWorkspace({ platformAdmin: false, memberships: [{ tenant_id: A, role: "owner" }, { tenant_id: MONARCH_TENANT_ID, role: "admin" }], openToAll: false }), { tenantId: MONARCH_TENANT_ID, role: "admin" });
  });
});

describe("choosing among several workspaces (Preview)", () => {
  const both = [{ tenant_id: MONARCH_TENANT_ID, role: "admin" }, { tenant_id: A, role: "owner" }];
  test("a chosen workspace wins when it is one of the person's own usable memberships", () => {
    assert.equal(chooseWorkspace({ platformAdmin: false, memberships: both, openToAll: true, preferred: A })!.tenantId, A);
    assert.equal(chooseWorkspace({ platformAdmin: false, memberships: both, openToAll: true, preferred: null })!.tenantId, MONARCH_TENANT_ID, "no choice: Monarch first, as before");
  });
  test("a workspace that is not theirs is ignored, whatever was asked for", () => {
    assert.equal(chooseWorkspace({ platformAdmin: false, memberships: both, openToAll: true, preferred: B })!.tenantId, MONARCH_TENANT_ID);
    assert.equal(chooseWorkspace({ platformAdmin: false, memberships: [{ tenant_id: MONARCH_TENANT_ID, role: "admin" }], openToAll: true, preferred: A })!.tenantId, MONARCH_TENANT_ID);
    assert.equal(chooseWorkspace({ platformAdmin: false, memberships: [{ tenant_id: A, role: "staff" }, { tenant_id: MONARCH_TENANT_ID, role: "admin" }], openToAll: true, preferred: A })!.tenantId, MONARCH_TENANT_ID, "a role that does not open a workspace cannot be chosen");
  });
  test("in production the choice changes nothing", () => {
    assert.equal(chooseWorkspace({ platformAdmin: false, memberships: both, openToAll: false, preferred: A })!.tenantId, MONARCH_TENANT_ID);
  });
  test("the chooser page and action exist only on Preview and re-check membership on the server", () => {
    const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
    assert.match(read("app/(admin)/switch-workspace/page.tsx"), /if \(!workspacesOpenToAll\(\)\) notFound\(\)/);
    assert.match(read("app/(admin)/switch-workspace/actions.ts"), /ok\.tenantId === wanted/);
  });
});

describe("the gate and the session", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  test("the workspace is never opened to other tenants in production", () => {
    assert.match(read("lib/workspace-tenant.ts"), /env\.VERCEL_ENV === "preview"/);
    assert.doesNotMatch(read("lib/workspace-tenant.ts"), /VERCEL_ENV === "production"|=> true;/);
  });

  test("requireAdmin admits by membership, remembers the tenant for this request, and returns it in the session", () => {
    const admin = read("lib/admin.ts");
    assert.match(admin, /chooseWorkspace\(\{ platformAdmin: false, memberships: await workspaceMemberships\(id\) \}\) !== null/);
    assert.match(admin, /rememberWorkspaceTenant\(tenantId\)/);
    assert.match(admin, /return \{ userId: decision\.userId, email: user\?\.email \?\? "", tenantId \}/);
    assert.match(read("lib/workspace-session.ts"), /cache\(\(\) => \(\{ tenantId: null/);
  });

  test("the workspace frame (layout, tab title, brand, Admin link) uses the tenant the gate resolved, never the Monarch default", () => {
    const layout = read("app/(admin)/layout.tsx");
    assert.match(layout, /loadBrand\(admin\.tenantId\)/);
    assert.match(layout, /loadBrand\(tenantId\)/);
    assert.doesNotMatch(layout, /currentTenantId/);
  });
});

describe("the old Monarch default may not spread", () => {
  // A ratchet: the count of currentTenantId() calls can only go down as the workspace moves to the resolved tenant.
  const BASELINE = 88;
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
