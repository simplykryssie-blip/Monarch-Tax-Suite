import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pickPublicOrigin } from "../lib/public-origin-pick.ts";

// Un-hardwiring Monarch, step 3 (Calendar): a workspace's booking links carry its own public address. A public page finds its workspace
// from the address it was opened on, so a link on the app's address would open Monarch's pages.

const APP = "https://app.verexahq.com";
const base = { production: false, brandLinkHost: null, siteHosts: [], isMonarch: false, appOrigin: APP };

describe("the address a workspace's public links use", () => {
  test("Monarch keeps the app's address (or its brand link address in production), exactly as before", () => {
    assert.equal(pickPublicOrigin({ ...base, isMonarch: true }), APP);
    assert.equal(pickPublicOrigin({ ...base, isMonarch: true, production: true, brandLinkHost: "links.monarchtaxsuite.com" }), "https://links.monarchtaxsuite.com");
    assert.equal(pickPublicOrigin({ ...base, isMonarch: true, siteHosts: [{ hostname: "monarch.sites.verexahq.com", kind: "subdomain", status: "active" }] }), APP, "Monarch's website address does not change its links");
  });

  test("another workspace uses its own domain first, then the default website address; never the app's address", () => {
    const sub = { hostname: "pat.sites.verexahq.com", kind: "subdomain" as const, status: "active" };
    const custom = { hostname: "www.patstax.com", kind: "custom" as const, status: "active" };
    assert.equal(pickPublicOrigin({ ...base, siteHosts: [sub] }), "https://pat.sites.verexahq.com");
    assert.equal(pickPublicOrigin({ ...base, siteHosts: [sub, custom] }), "https://www.patstax.com");
    assert.equal(pickPublicOrigin({ ...base, siteHosts: [{ ...custom, status: "pending" }, sub] }), "https://pat.sites.verexahq.com", "an address that is not live yet is not used");
  });

  test("a workspace with no public address yet gets none (the page tells them how to get one), not Monarch's", () => {
    assert.equal(pickPublicOrigin(base), null);
    assert.equal(pickPublicOrigin({ ...base, siteHosts: [{ hostname: "x.sites.verexahq.com", kind: "subdomain", status: "pending" }] }), null);
  });
});

describe("workspace pages carry the resolved tenant, not Monarch's id", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  test("the service orders page lists the signed-in workspace's orders", () => {
    const page = read("app/(admin)/service-orders/page.tsx");
    assert.match(page, /listServiceOrders\(admin\.tenantId\)/);
    assert.doesNotMatch(page, /MONARCH_TENANT_ID/);
  });
  test("booking and appointment links are built from the workspace's public address", () => {
    assert.match(read("lib/appointments/server.ts"), /publicOriginFor\(tenantId\)/);
    const sections = read("app/(admin)/settings/calendar/sections.tsx");
    assert.match(sections, /href=\{`\$\{origin\}\/book`\}/);
    assert.doesNotMatch(sections, /href="\/book"/);
  });
});

import { defaultHostFor, labelOfDefaultHost } from "../lib/default-host-pick.ts";

test("a workspace with no website still has an address of its own", () => {
  const base = { production: false, brandLinkHost: null, siteHosts: [], isMonarch: false, appOrigin: "https://app.example" };
  assert.equal(pickPublicOrigin({ ...base, defaultHost: "ptin-walk-test.sites.verexahq.com" }), "https://ptin-walk-test.sites.verexahq.com");
  assert.equal(pickPublicOrigin({ ...base }), null);
  // A website's address still wins over the default one, and Monarch keeps the app's own address.
  assert.equal(pickPublicOrigin({ ...base, defaultHost: "x.sites.verexahq.com", siteHosts: [{ hostname: "site.sites.verexahq.com", kind: "subdomain", status: "active" }] }), "https://site.sites.verexahq.com");
  assert.equal(pickPublicOrigin({ ...base, isMonarch: true, defaultHost: "monarch.sites.verexahq.com" }), "https://app.example");
});

test("the default address is the workspace name under the platform site domain, both ways", () => {
  const d = "sites.verexahq.com";
  assert.equal(defaultHostFor("ptin-walk-test", d), "ptin-walk-test.sites.verexahq.com");
  assert.equal(defaultHostFor("Smith Tax", d), null);
  assert.equal(defaultHostFor("admin", d, new Set(["admin"])), null);
  assert.equal(labelOfDefaultHost("ptin-walk-test.sites.verexahq.com", d), "ptin-walk-test");
  assert.equal(labelOfDefaultHost("a.b.sites.verexahq.com", d), null);
  assert.equal(labelOfDefaultHost("www.sites.verexahq.com", d, new Set(["www"])), null);
  assert.equal(labelOfDefaultHost("example.com", d), null);
});

import { signupSlugs } from "../lib/practice/service.ts";

test("sign-up addresses: the name itself first, a payment mark only as the fallback, always a valid address", () => {
  assert.deepEqual(signupSlugs("Smith & Sons Tax, LLC", "ab12cd"), ["smith-sons-tax-llc", "smith-sons-tax-llc-ab12cd"]);
  // A name the platform keeps, or that is too short to be an address, still gets one.
  assert.deepEqual(signupSlugs("Admin", "ab12cd"), ["admin-ab12cd"]);
  assert.match(signupSlugs("A", "ab12cd")[0], /^[a-z0-9-]{3,40}$/);
  for (const n of ["x".repeat(80), "Ünïcode Tax", "!!!"]) for (const s of signupSlugs(n, "ab12cd")) assert.match(s, /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/);
});
