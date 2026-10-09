import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MemoryRepo } from "./memory-repo.ts";
import { createProduct } from "../lib/commerce/catalog.ts";
import {
  authorizeDomain,
  createIntakeLink,
  getIntake,
  handleStripeEvent,
  issueLicenseKey,
  setLicenseStatus,
  submitIntake,
  updateInstallation,
} from "../lib/commerce/fulfillment.ts";
import { allowedHosts, decideEmbed, EMBED_ID_PATTERN, frameAncestors } from "../lib/commerce/embed.ts";
import { embedSnippet, PLATFORM_GUIDES, PLATFORM_ORDER } from "../lib/commerce/platforms.ts";
import { PLATFORMS, type NewProduct } from "../lib/commerce/types.ts";
import { normalizeWebsiteUrl, ValidationError } from "../lib/commerce/validation.ts";

const PRODUCT: NewProduct = {
  slug: "monarch-basic-tax-calculator",
  name: "Monarch Basic Tax Calculator",
  description: null,
  product_type: "software",
  access_type: "license",
  installation_options: ["self_service", "done_for_you"],
  price_cents: 7500,
  currency: "usd",
  stripe_product_id: "prod_TESTCALC123",
  stripe_price_id: null,
  status: "draft",
};

async function purchased(metadata: Record<string, string> = {}) {
  const repo = new MemoryRepo();
  await createProduct(repo, PRODUCT);
  await handleStripeEvent(
    { repo, listCheckoutProductIds: async () => ["prod_TESTCALC123"] },
    {
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          payment_status: "paid",
          payment_intent: "pi_TEST000001",
          amount_total: 7500,
          currency: "usd",
          customer: null,
          customer_details: { email: "buyer@example.com", name: "Buyer" },
          metadata,
        },
      },
    },
  );
  return { repo, license: repo.licenses[0], installation: repo.installations[0] };
}

describe("platform catalog", () => {
  test("every platform has a guide, steps, and a valid default method", () => {
    assert.deepEqual([...PLATFORM_ORDER].sort(), [...PLATFORMS].sort());
    for (const p of PLATFORMS) {
      const g = PLATFORM_GUIDES[p];
      assert.ok(g.steps.length > 0, p);
      assert.ok(g.methods.includes(g.defaultMethod), p);
    }
    assert.equal(PLATFORM_GUIDES.gohighlevel.support === "verified", false, "GHL is not verified until tested on a live funnel");
  });

  test("embed snippet carries only the public embed id", () => {
    const snippet = embedSnippet("https://monarch.example", "emb_abcdefghijklmnop");
    assert.match(snippet, /<iframe src="https:\/\/monarch\.example\/embed\/calculator\?id=emb_abcdefghijklmnop"/);
    assert.doesNotMatch(snippet, /MTS-/);
  });

  test("website URLs are normalized and unsafe schemes rejected", () => {
    assert.equal(normalizeWebsiteUrl("example.com/calc#x"), "https://example.com/calc");
    assert.throws(() => normalizeWebsiteUrl("javascript:alert(1)"), ValidationError);
  });
});

describe("checkout metadata", () => {
  test("Shopify, Wix and other platforms from checkout are recorded with platform-specific methods", async () => {
    const shopify = await purchased({ installation_type: "self_service", platform: "shopify", website_url: "https://store.example.com/pages/tax", domain: "store.example.com" });
    assert.equal(shopify.installation.platform, "shopify");
    assert.equal(shopify.installation.installation_method, "shopify_custom_liquid");
    assert.equal(shopify.installation.website_url, "https://store.example.com/pages/tax");
    assert.equal(shopify.installation.target_location, "store.example.com");

    const wix = await purchased({ platform: "wix" });
    assert.equal(wix.installation.installation_method, "wix_embed_site");

    const other = await purchased({ platform: "other", platform_other: "Squarespace" });
    assert.equal(other.installation.platform_other, "Squarespace");

    const junk = await purchased({ platform: "myspace", domain: "not a domain" });
    assert.equal(junk.installation.platform, "other");
    assert.equal(junk.installation.target_location, null);
  });
});

describe("platform-neutral license validation", () => {
  async function activeLicense() {
    const { repo, license } = await purchased();
    const { license: issued } = await issueLicenseKey(repo, license.id, "admin");
    assert.match(issued.embed_id!, EMBED_ID_PATTERN);
    await authorizeDomain(repo, license.id, "clientfirm.com", "admin");
    return { repo, licenseId: license.id };
  }

  test("authorized domain (and its www variant) passes regardless of platform", async () => {
    const { repo, licenseId } = await activeLicense();
    const license = await repo.getLicense(licenseId);
    const domains = await repo.listDomains(licenseId);
    assert.deepEqual(allowedHosts(domains), ["clientfirm.com", "www.clientfirm.com"]);
    assert.equal(decideEmbed(license, domains, "clientfirm.com").ok, true);
    assert.equal(decideEmbed(license, domains, "www.clientfirm.com").ok, true);
    assert.equal(decideEmbed(license, domains, null).ok, true);
    assert.equal(frameAncestors(decideEmbed(license, domains, null)), "frame-ancestors https://clientfirm.com https://www.clientfirm.com");
  });

  test("unauthorized domains are refused and cannot frame the calculator", async () => {
    const { repo, licenseId } = await activeLicense();
    const license = await repo.getLicense(licenseId);
    const domains = await repo.listDomains(licenseId);
    const decision = decideEmbed(license, domains, "evil.example");
    assert.deepEqual(decision.ok ? null : decision.reason, "domain_not_authorized");
    assert.equal(frameAncestors(decision), "frame-ancestors https://clientfirm.com https://www.clientfirm.com");
  });

  test("suspended, revoked, pending, unknown and domain-less licenses are refused", async () => {
    const { repo, licenseId } = await activeLicense();
    const domains = await repo.listDomains(licenseId);
    await setLicenseStatus(repo, licenseId, "suspended", null, "admin");
    const suspended = decideEmbed(await repo.getLicense(licenseId), domains, "clientfirm.com");
    assert.equal(suspended.ok ? null : suspended.reason, "inactive");
    assert.equal(frameAncestors(suspended), "frame-ancestors 'none'");
    await setLicenseStatus(repo, licenseId, "revoked", "Refund", "admin");
    assert.equal(decideEmbed(await repo.getLicense(licenseId), domains, "clientfirm.com").ok, false);
    assert.equal(frameAncestors(decideEmbed(null, [], "clientfirm.com")), "frame-ancestors 'none'");

    const fresh = await purchased();
    const pending = decideEmbed(fresh.license, [], "clientfirm.com");
    assert.equal(pending.ok ? null : pending.reason, "inactive");
    const { license: issued } = await issueLicenseKey(fresh.repo, fresh.license.id, "admin");
    const noDomains = decideEmbed(issued, [], "clientfirm.com");
    assert.equal(noDomains.ok ? null : noDomains.reason, "no_domains");
  });

  test("removed domains stop working", async () => {
    const { repo, licenseId } = await activeLicense();
    await repo.upsertDomain(licenseId, "clientfirm.com", "removed");
    const decision = decideEmbed(await repo.getLicense(licenseId), await repo.listDomains(licenseId), "clientfirm.com");
    assert.equal(decision.ok ? null : decision.reason, "no_domains");
  });
});

describe("customer installation intake", () => {
  test("self-service intake on an active license authorizes the domain and is single use", async () => {
    const { repo, license, installation } = await purchased({ installation_type: "self_service" });
    await issueLicenseKey(repo, license.id, "admin");
    const { token } = await createIntakeLink(repo, installation.id, "admin");
    assert.ok(await getIntake(repo, token));
    assert.ok(!JSON.stringify(repo.installations).includes(token), "only the token hash is stored");

    const result = await submitIntake(repo, token, { platform: "wix", platform_other: null, website_url: "https://www.firm.com/estimate", domain: "firm.com", installation_type: "self_service" });
    assert.equal(result.domainAuthorized, true);
    assert.equal(result.installation.platform, "wix");
    assert.equal(result.installation.installation_method, "wix_embed_site");
    assert.equal(result.installation.status, "requested");
    assert.equal(decideEmbed(await repo.getLicense(license.id), await repo.listDomains(license.id), "www.firm.com").ok, true);

    await assert.rejects(submitIntake(repo, token, { platform: "wix", platform_other: null, website_url: "https://x.com", domain: "x.com", installation_type: "self_service" }), /invalid or has expired/);
  });

  test("Done For You intake records details but never activates or authorizes", async () => {
    const { repo, license, installation } = await purchased({ installation_type: "done_for_you" });
    await issueLicenseKey(repo, license.id, "admin");
    const { token } = await createIntakeLink(repo, installation.id, "admin");
    const result = await submitIntake(repo, token, { platform: "shopify", platform_other: null, website_url: "https://shop.example.com", domain: "shop.example.com", installation_type: "done_for_you" });
    assert.equal(result.domainAuthorized, false);
    assert.equal(result.installation.status, "requested");
    assert.equal((await repo.listDomains(license.id)).length, 0);
  });

  test("expired links, other-platform without a name, and type mismatches are handled", async () => {
    const { repo, installation } = await purchased({ installation_type: "done_for_you" });
    const { token } = await createIntakeLink(repo, installation.id, "admin", () => "2026-01-01T00:00:00.000Z");
    assert.equal(await getIntake(repo, token, () => "2026-02-01T00:00:00.000Z"), null);

    const { token: t2 } = await createIntakeLink(repo, installation.id, "admin");
    await assert.rejects(submitIntake(repo, t2, { platform: "other", platform_other: null, website_url: "https://a.com", domain: "a.com", installation_type: "done_for_you" }), /which platform/);
    await submitIntake(repo, t2, { platform: "other", platform_other: "Squarespace", website_url: "https://a.com", domain: "a.com", installation_type: "self_service" });
    const history = repo.installationEvents.map((e) => e.note ?? "").join("\n");
    assert.match(history, /purchased as Done For You; confirm/);
  });

  test("installation methods must match the platform", async () => {
    const { repo, installation } = await purchased({ platform: "jotform" });
    await assert.rejects(updateInstallation(repo, installation.id, { installation_method: "shopify_custom_liquid" }, "admin"), /not available for this platform/);
    const updated = await updateInstallation(repo, installation.id, { platform: "shopify", installation_method: "shopify_custom_liquid", requirements: "Theme must support Custom Liquid sections." }, "admin");
    assert.equal(updated.installation_method, "shopify_custom_liquid");
  });
});
