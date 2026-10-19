import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { PLATFORM, tenantBrand } from "../lib/platform-brand.ts";
import { MONARCH_TENANT_ID } from "../lib/tenants.ts";

// Platform branding is Verexa HQ; each tenant keeps its own brand for what its customers see.

test("the platform is Verexa HQ and its brand files exist", () => {
  assert.equal(PLATFORM.name, "Verexa HQ");
  for (const f of [PLATFORM.logo, PLATFORM.logoFull, PLATFORM.mark]) assert.ok(existsSync(`public${f}`), f);
  for (const f of [PLATFORM.favicon, PLATFORM.appleIcon, PLATFORM.ogImage.url]) assert.ok(existsSync(`public${f}`), f);
});

test("Monarch keeps its own brand as a tenant; other accounts use their firm name", () => {
  assert.deepEqual(tenantBrand(MONARCH_TENANT_ID, "Something else"), { name: "Monarch Tax Suite", mark: "/brand/mark.png" });
  assert.ok(existsSync("public/brand/mark.png"));
  assert.deepEqual(tenantBrand("00000000-0000-4000-8000-0000000000aa", " Acme Tax "), { name: "Acme Tax", mark: null });
  assert.equal(tenantBrand("00000000-0000-4000-8000-0000000000aa", null).name, "Your account");
});
