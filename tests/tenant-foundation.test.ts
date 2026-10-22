import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MONARCH_TENANT_ID, TENANT_HEADER, currentTenantId, tenantHeaders } from "../lib/tenants.ts";

// Phase 2 Step 0: every tenant table carries tenant_id, and server code reaches tenant data only through the
// tenant-scoped client. The database half of the gate is supabase/tests/tenant_isolation.sql.

const ROOT = new URL("..", import.meta.url).pathname;
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FOUNDATION = "20261014090000_tenant_foundation.sql";

/** Tables that belong to the platform, not to a tenant. Adding one here needs a reason. */
const PLATFORM_TABLES = new Set([
  "tenants", // the tenants themselves
  "tenant_members", // carries tenant_id; has its own policies
  "admin_users", // platform administrators
  "rate_limit_counters", // abuse counters keyed by hashed client, shared across tenants
  "platform_suppressions", // addresses (keyed hash only) that hard-bounced or complained anywhere; about the address, not an office
]);

const sql = (file: string) => readFileSync(join(MIGRATIONS, file), "utf8");
const migrationFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const createdTables = (text: string) => [...text.matchAll(/create table if not exists public\.([a-z0-9_]+)/g)].map((m) => m[1]);

function foundationTables(): string[] {
  const block = sql(FOUNDATION).match(/tenant_tables text\[\] := array\[([\s\S]*?)\];/);
  assert.ok(block, "tenant table list in the foundation migration");
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("every table has a tenant", () => {
  test("tables created before the foundation are all in its tenant list or are platform tables", () => {
    const listed = new Set(foundationTables());
    const before = migrationFiles.filter((f) => f < FOUNDATION).flatMap((f) => createdTables(sql(f)));
    const missing = before.filter((t) => !listed.has(t) && !PLATFORM_TABLES.has(t));
    assert.deepEqual(missing, []);
  });

  test("tables created after the foundation carry tenant_id from day one", () => {
    for (const file of migrationFiles.filter((f) => f > FOUNDATION)) {
      const text = sql(file);
      for (const table of createdTables(text)) {
        if (PLATFORM_TABLES.has(table)) continue;
        const body = text.slice(text.indexOf(`create table if not exists public.${table}`)).split(/\n\);/)[0];
        assert.match(body, /tenant_id uuid not null/, `${file}: ${table} has no tenant_id`);
        assert.match(text, new RegExp(`policy tenant_isolation on public\\.${table}|tenant_tables[^;]*'${table}'`), `${file}: ${table} has no tenant policy`);
      }
    }
  });

  test("the foundation backfills to Monarch, then requires a tenant for new rows", () => {
    const text = sql(FOUNDATION);
    assert.ok(text.includes(`'${MONARCH_TENANT_ID}'`));
    assert.match(text, /set default public\.require_tenant_id\(\)/);
    assert.match(text, /raise exception 'tenant_id is required/);
  });
});

describe("server code reaches tenant data through the tenant client", () => {
  const files = ["lib", "app", "components"].flatMap((d) => sourceFiles(join(ROOT, d)));

  test("nothing uses the old unscoped service client", () => {
    const users = files.filter((f) => /\bserviceClient\b/.test(readFileSync(f, "utf8")));
    assert.deepEqual(users, []);
  });

  test("platform access is limited to platform tables", () => {
    const uses = files.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/platformClient\("([a-z_]+)"\)\.(from|rpc)\("([a-z_]+)"/g)].map((m) => `${m[1]}:${m[3]}`));
    assert.deepEqual(uses.sort(), ["admin_lookup:admin_users", "billing_sweep:tenant_subscriptions", "billing_webhook:billing_events", "billing_webhook:tenant_subscriptions", "brand_host:tenant_brands", "campaign_token:campaign_recipients", "campaign_token:campaign_recipients", "campaign_token:campaign_recipients", "connect_webhook:payment_connections", "document_link:document_deliveries", "form_link:forms", "office_invite:office_members", "office_member:office_members", "office_member:office_members", "portal_invite:portal_members", "portal_member:portal_members", "portal_member:portal_members", "practice_invite:practice_members", "practice_member:practice_members", "practice_member:practice_members", "practice_member:tenants", "rate_limit:hit_rate_limit", "scheduler_tick:tenants", "signup:office_members", "signup:practice_members", "site_host:site_domains", "site_host:site_domains", "site_host:site_domains", "sms_inbound:tenant_sms_accounts", "sms_sweep:tenants", "suppression:platform_suppressions", "suppression:platform_suppressions", "wisp_link:email_domains", "workspace_member:tenant_members"]);
    // The platform uses that aren't a table read: creating the sign-in for an accepted invite, and creating a PTIN workspace.
    const other = files.filter((f) => !f.endsWith("lib/supabase/service.ts") && /platformClient\(/.test(readFileSync(f, "utf8").replace(/platformClient\("[a-z_]+"\)\.(from|rpc)\("[a-z_]+"/g, "").replace(/platformClient\("(office|practice|portal)_invite"\)\.auth\.admin\.createUser\(/g, "").replace(/new SupabasePracticePlatform\(platformClient\("practice_provision"\)\)/g, "")));
    assert.deepEqual(other, []);
  });

  test("every request names a valid tenant", () => {
    assert.deepEqual(tenantHeaders(MONARCH_TENANT_ID), { [TENANT_HEADER]: MONARCH_TENANT_ID });
    assert.throws(() => tenantHeaders(""), /tenant id is required/);
    assert.throws(() => tenantHeaders("monarch"), /tenant id is required/);
    assert.equal(currentTenantId(), MONARCH_TENANT_ID);
  });
});
