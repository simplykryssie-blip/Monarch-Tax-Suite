import { test } from "node:test";
import assert from "node:assert/strict";
import { decideEmbed, frameAncestors, hostFromHeader, isTopLevelNavigation } from "../lib/commerce/embed.ts";
import type { AuthorizedDomain, License } from "../lib/commerce/types.ts";

// Authorized-embedding rules. Authorization is the license plus the browser-enforced
// frame-ancestors policy; a Referer, when present, is only an extra check.

const license = (over: Partial<License> = {}): License => ({
  id: "l1", customer_id: "c1", order_id: "o1", product_id: "p1", key_hash: "a".repeat(64), key_prefix: "MTS-AAAAA", embed_id: "emb_aaaaaaaaaaaaaaaaaaaa",
  original_tax_year: 2026, licensed_tax_year: 2026, status: "active", max_domains: 3, issued_at: null, activated_at: null, revoked_at: null, revoke_reason: null, created_at: "", updated_at: "", ...over,
});
const dom = (domain: string, status: AuthorizedDomain["status"] = "active"): AuthorizedDomain => ({ id: domain, license_id: "l1", domain, status, created_at: "" });

test("an authorized site (and its www/apex twin) may frame the calculator; the policy names only those hosts", () => {
  const d = decideEmbed(license(), [dom("clients.example.com")], "clients.example.com");
  assert.equal(d.ok, true);
  assert.equal(frameAncestors(d), "frame-ancestors https://clients.example.com https://www.clients.example.com");
});

test("a browser that sends no Referer is not locked out, and the policy still restricts where it can render", () => {
  const d = decideEmbed(license(), [dom("clients.example.com")], null);
  assert.equal(d.ok, true);
  assert.match(frameAncestors(d), /^frame-ancestors https:\/\/clients\.example\.com/);
  assert.ok(!frameAncestors(d).includes("*"));
});

test("a Referer from another site is refused, and the policy still lists only the authorized hosts", () => {
  const d = decideEmbed(license(), [dom("clients.example.com")], "evil.example");
  assert.equal(d.ok, false);
  assert.equal(frameAncestors(d), "frame-ancestors https://clients.example.com https://www.clients.example.com");
});

test("a Referer cannot unlock anything: no domains, revoked and suspended licenses can be framed by nobody", () => {
  assert.equal(frameAncestors(decideEmbed(license(), [], "clients.example.com")), "frame-ancestors 'none'");
  assert.equal(frameAncestors(decideEmbed(license({ status: "revoked" }), [dom("clients.example.com")], "clients.example.com")), "frame-ancestors 'none'");
  assert.equal(frameAncestors(decideEmbed(license({ status: "suspended" }), [dom("clients.example.com")], null)), "frame-ancestors 'none'");
  assert.equal(frameAncestors(decideEmbed(null, [], null)), "frame-ancestors 'none'");
  assert.equal(frameAncestors(decideEmbed(license(), [dom("old.example.com", "removed" as AuthorizedDomain["status"])], null)), "frame-ancestors 'none'");
});

test("direct visits are refused only when the browser says it is a top-level page; iframes and silent browsers are not blocked", () => {
  assert.equal(isTopLevelNavigation("document"), true);
  assert.equal(isTopLevelNavigation("Document"), true);
  assert.equal(isTopLevelNavigation("iframe"), false);
  assert.equal(isTopLevelNavigation("frame"), false);
  assert.equal(isTopLevelNavigation(""), false);
  assert.equal(isTopLevelNavigation(null), false);
  assert.equal(isTopLevelNavigation(undefined), false);
});

test("malformed Referer values are ignored rather than trusted", () => {
  assert.equal(hostFromHeader("not a url"), null);
  assert.equal(hostFromHeader(""), null);
  assert.equal(hostFromHeader("https://Clients.Example.com/page?x=1"), "clients.example.com");
});
