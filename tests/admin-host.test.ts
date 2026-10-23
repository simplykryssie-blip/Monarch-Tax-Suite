import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminHosts, adminRouteVerdict, adminSeparationOn, isAdminHost, roleOpensWorkspace } from "../lib/admin-host.ts";
import { classifyHost } from "../lib/sites/host.ts";

// The platform admin has its own address. With it unset nothing changes; with it set, /admin lives only there.

const ON = { ADMIN_HOSTS: "admin.verexahq.com" };
const OFF = {};

describe("admin address", () => {
  test("unset means separation is off and every request is allowed", () => {
    assert.equal(adminSeparationOn(OFF), false);
    for (const [host, path] of [["app.verexahq.com", "/admin/workspaces"], ["admin.verexahq.com", "/leads"], ["app.verexahq.com", "/"]]) {
      assert.deepEqual(adminRouteVerdict(host, path, OFF), { action: "allow" });
    }
  });

  test("host matching ignores case, port and a trailing dot, and takes a list", () => {
    const env = { ADMIN_HOSTS: " Admin.VerexaHQ.com:443 , admin2.verexahq.com. " };
    assert.deepEqual(adminHosts(env), ["admin.verexahq.com", "admin2.verexahq.com"]);
    assert.ok(isAdminHost("ADMIN.verexahq.com", env));
    assert.ok(isAdminHost("admin2.verexahq.com", env));
    assert.ok(!isAdminHost("app.verexahq.com", env));
    assert.ok(!isAdminHost(null, env));
  });

  test("on any other address /admin is denied with 403, not hidden", () => {
    for (const host of ["app.verexahq.com", "preview.verexahq.com", "office.sites.verexahq.com", "", null]) {
      for (const path of ["/admin", "/admin/workspaces", "/admin/billing-setup/x"]) {
        const v = adminRouteVerdict(host, path, ON);
        assert.equal(v.action, "deny", `${host} ${path}`);
        assert.equal((v as { status: number }).status, 403);
      }
    }
  });

  test("a path that only starts with the letters 'admin' is not the admin area", () => {
    assert.deepEqual(adminRouteVerdict("app.verexahq.com", "/administration", ON), { action: "allow" });
    assert.deepEqual(adminRouteVerdict("app.verexahq.com", "/adminx/y", ON), { action: "allow" });
  });

  test("tenant addresses keep working for everything else", () => {
    for (const path of ["/", "/leads", "/workspace/clients", "/office", "/practice/billing", "/portal", "/login"]) {
      assert.deepEqual(adminRouteVerdict("app.verexahq.com", path, ON), { action: "allow" }, path);
    }
  });

  test("the admin address serves /admin and sign-in only; the root goes to the admin home; the rest is 404", () => {
    for (const path of ["/admin/workspaces", "/admin/integrations", "/login", "/forgot-password", "/reset-password"]) {
      assert.deepEqual(adminRouteVerdict("admin.verexahq.com", path, ON), { action: "allow" }, path);
    }
    assert.deepEqual(adminRouteVerdict("admin.verexahq.com", "/", ON), { action: "redirect", to: "/admin/workspaces" });
    for (const path of ["/leads", "/workspace", "/office", "/practice", "/portal", "/store", "/settings/payments", "/f/abc", "/api/stripe/webhook", "/loginx"]) {
      const v = adminRouteVerdict("admin.verexahq.com", path, ON);
      assert.equal(v.action, "deny", path);
      assert.equal((v as { status: number }).status, 404);
    }
  });

  test("the admin address is an application host, never looked up as an office website", () => {
    assert.deepEqual(classifyHost("admin.verexahq.com", ON), { kind: "app" });
    assert.notEqual(classifyHost("admin.verexahq.com", OFF).kind, "app");
  });

  test("only owners and admins of the Monarch workspace open it; staff and strangers do not", () => {
    assert.ok(roleOpensWorkspace("owner"));
    assert.ok(roleOpensWorkspace("admin"));
    assert.ok(!roleOpensWorkspace("staff"));
    assert.ok(!roleOpensWorkspace(null));
    assert.ok(!roleOpensWorkspace(undefined));
    assert.ok(!roleOpensWorkspace("platform"));
  });
});

describe("access wiring", () => {
  const admin = readFileSync(new URL("../lib/admin.ts", import.meta.url), "utf8");

  test("the workspace gate looks only at the Monarch tenant's own members", () => {
    assert.match(admin, /from\("tenant_members"\)[\s\S]{0,120}\.eq\("tenant_id", MONARCH_TENANT_ID\)/);
  });

  test("the platform area is still decided by the platform-admin list alone", () => {
    const platform = admin.slice(admin.indexOf("export const requirePlatformAdmin"));
    assert.match(platform, /isAdminUser\(session\.userId\)/);
    assert.ok(!/isMonarchMember/.test(platform), "membership must never open the platform area");
  });

  test("the office area's bureau-admin check still uses the platform-admin list only", () => {
    const fn = admin.slice(admin.indexOf("export async function isAdminUser"), admin.indexOf("export async function isAdminUser") + 200);
    assert.match(fn, /lookupAdmin\(userId\)\) === "yes"/);
  });

  test("the proxy decides the admin address before anything else", () => {
    const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
    assert.ok(proxy.indexOf("adminRouteVerdict(") < proxy.indexOf("classifyHost("));
  });
});
