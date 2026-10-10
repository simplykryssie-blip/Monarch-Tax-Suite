import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Customers are not signed in. If these paths fall behind the admin login gate, the emailed setup link
// sends them to a sign-in page (found on the live site), so keep them public. Each authorizes itself.
const source = readFileSync(new URL("../lib/supabase/proxy.ts", import.meta.url), "utf8");
const list = source.match(/const PUBLIC_PATHS: string\[\] = \[([\s\S]*?)\];/)?.[1] ?? "";

for (const path of ["/setup", "/api/automation/run", "/integrations", "/api/stripe/webhook", "/api/integrations/crm/", "/api/leads"]) {
  test(`${path} is reachable without an admin session`, () => {
    assert.ok(list.includes(`"${path}"`), `${path} missing from PUBLIC_PATHS`);
  });
}

test("admin areas are not public", () => {
  for (const admin of ["/automation", "/licenses", "/customers", "/orders", "/products"]) {
    assert.ok(!list.includes(`"${admin}"`), `${admin} must stay behind admin login`);
  }
});
