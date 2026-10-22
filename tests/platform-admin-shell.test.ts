import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanDetail, isPlatformAction, PLATFORM_ACTIONS, PLATFORM_ACTION_LABEL } from "../lib/platform-audit.ts";
import { MONARCH_TENANT_ID, PLATFORM_TENANT_ID } from "../lib/tenants.ts";
import { NAV, isBranch } from "../lib/nav.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("platform audit trail", () => {
  test("every platform action has a label, a platform_ prefix, and is recognized", () => {
    for (const a of PLATFORM_ACTIONS) {
      assert.ok(a.startsWith("platform_"));
      assert.ok(PLATFORM_ACTION_LABEL[a].length > 0);
      assert.ok(isPlatformAction(a));
    }
    assert.ok(!isPlatformAction("invite_emailed"));
    assert.ok(!isPlatformAction("platform_unknown"));
  });

  test("details keep simple values only, drop anything secret-like, and are bounded", () => {
    const d = cleanDetail({ workspace: "Pat's Taxes", n: 3, ok: true, long: "x".repeat(500), api_key: "sk_live_x", secretValue: "x", token: "t", password: "p", nested: { a: 1 }, list: [1] });
    assert.deepEqual(Object.keys(d).sort(), ["long", "n", "ok", "workspace"]);
    assert.equal(d.long.length, 200);
    assert.equal(d.n, "3");
    assert.deepEqual(cleanDetail(undefined), {});
    assert.ok(Object.keys(cleanDetail(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, "v"])))).length <= 8);
  });

  test("the platform is its own record, never Monarch's", () => {
    assert.notEqual(PLATFORM_TENANT_ID, MONARCH_TENANT_ID);
    const sql = read("supabase/migrations/20261118090000_platform_tenant.sql");
    assert.ok(sql.includes(PLATFORM_TENANT_ID));
    assert.match(sql, /on conflict \(id\) do nothing/);
    assert.ok(!/delete|drop|truncate|alter table/i.test(sql.replace(/--.*$/gm, "")), "the migration only adds the record");
  });

  test("the actions that need recording are recorded", () => {
    const ws = read("app/(admin)/admin/workspaces/actions.ts");
    for (const a of ["platform_workspace_created", "platform_invite_resent", "platform_access_changed"]) assert.ok(ws.includes(a), a);
    assert.ok(read("app/(admin)/admin/billing-setup/actions.ts").includes("platform_billing_setup_run"));
    const audit = read("lib/platform-audit-server.ts");
    assert.match(audit, /PLATFORM_TENANT_ID/);
    assert.ok(!/delete\(|update\(/.test(audit), "the trail is only ever added to");
  });
});

describe("platform admin shell", () => {
  test("the platform frame's menu matches the Admin group in the main menu", () => {
    const shell = read("components/admin/platform-shell.tsx");
    const hrefs = [...shell.matchAll(/href: "(\/admin\/[a-z-]+)"/g)].map((m) => m[1]);
    const admin = NAV.find((e) => e.label === "Admin");
    assert.ok(admin && isBranch(admin));
    assert.deepEqual(hrefs, (admin as { items: { href?: string }[] }).items.map((i) => i.href));
  });

  test("pages under /admin get the platform frame, never a workspace's", () => {
    const layout = read("app/(admin)/layout.tsx");
    assert.match(layout, /path === "\/admin" \|\| path\.startsWith\("\/admin\/"\)\) return <PlatformShell/);
    assert.ok(layout.indexOf("<PlatformShell") < layout.indexOf("loadAlerts("), "no workspace data is loaded for the platform frame");
    assert.ok(!/loadBrand|loadAlerts|currentTier|AdminShell/.test(read("components/admin/platform-shell.tsx")), "the platform frame uses no workspace data");
  });

  test("the new screens are platform-admin only and read-only", () => {
    for (const p of ["app/(admin)/admin/legal/page.tsx", "app/(admin)/admin/activity/page.tsx"]) {
      const src = read(p);
      assert.match(src, /requirePlatformAdmin\(\)/);
      assert.ok(!/"use server"|action=\{/.test(src), `${p} must not change anything`);
    }
  });

  test("the legal status shows state without values", () => {
    const src = read("app/(admin)/admin/legal/page.tsx");
    assert.ok(!/TURNSTILE_SECRET_KEY\]|env\.TURNSTILE_SECRET_KEY|STRIPE_BILLING_SECRET_KEY\]/.test(src), "never reads a secret value to show it");
  });

  test("the schedulers skip the platform record", () => {
    assert.match(read("app/api/automation/tick/route.ts"), /id !== PLATFORM_TENANT_ID/);
    assert.match(read("lib/sms/server.ts"), /neq\("id", PLATFORM_TENANT_ID\)/);
  });
});
