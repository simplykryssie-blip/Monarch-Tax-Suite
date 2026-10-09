import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { MemoryRepo } from "./memory-repo.ts";
import { FakeHighLevel, MemoryCrmRepo } from "./crm-memory.ts";
import { CrmSecrets } from "../lib/crm/crypto.ts";
import { HighLevelError } from "../lib/crm/highlevel.ts";
import { completeConnection, disconnect, setWebhook, startConnection, testDestination, withAccessToken, type CrmDeps } from "../lib/crm/connection.ts";
import { forwardLead, issueEmbedToken, parseLead, type LeadSubmission } from "../lib/crm/leads.ts";
import { isPrivateAddress, parseWebhookUrl, signWebhook, type WebhookSender } from "../lib/crm/webhook.ts";
import { createProduct } from "../lib/commerce/catalog.ts";
import { authorizeDomain, issueLicenseKey, reconcilePurchase } from "../lib/commerce/fulfillment.ts";
import { decideEmbed } from "../lib/commerce/embed.ts";
import { licensedYears } from "../lib/commerce/versions.ts";
import { hashLicenseKey } from "../lib/commerce/license-keys.ts";
import { ValidationError } from "../lib/commerce/validation.ts";
import type { License } from "../lib/commerce/types.ts";

const REDIRECT = "https://monarch.test/api/integrations/crm/callback";

function license(over: Partial<License> = {}): License {
  const id = randomUUID();
  return {
    id, customer_id: randomUUID(), order_id: randomUUID(), product_id: randomUUID(), key_hash: "a".repeat(64), key_prefix: "MTS-AAAAA", embed_id: `emb_${id.slice(0, 20)}`,
    original_tax_year: 2026, licensed_tax_year: 2026, status: "active", max_domains: 3, issued_at: null, activated_at: null, revoked_at: null, revoke_reason: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over,
  };
}

type Sent = { url: string; secret: string; body: Record<string, unknown>; key: string };

function setup() {
  const commerce = new MemoryRepo();
  const repo = new MemoryCrmRepo();
  const api = new FakeHighLevel();
  api.addLocation("locAAAAAAAA", "Buyer A Tax Co");
  api.addLocation("locBBBBBBBB", "Buyer B Accounting");
  const sent: Sent[] = [];
  const hooks = { fail: 0, status: 200 };
  const webhook: WebhookSender = async (target, body, key) => {
    if (hooks.fail > 0) {
      hooks.fail--;
      return { ok: false, status: 503, reason: "http_error" };
    }
    sent.push({ url: target.url, secret: target.secret, body: body as Record<string, unknown>, key });
    return { ok: true, status: hooks.status };
  };
  const clock = { t: Date.now() };
  const deps: CrmDeps = { repo, commerce, api, secrets: new CrmSecrets(randomBytes(32)), webhook, now: () => new Date(clock.t), sleep: async () => undefined };
  const A = license();
  const B = license();
  commerce.licenses.push(A, B);
  commerce.domains.push(
    { id: randomUUID(), license_id: A.id, domain: "buyer-a.com", status: "active", created_at: "" },
    { id: randomUUID(), license_id: B.id, domain: "buyer-b.com", status: "active", created_at: "" },
  );
  return { deps, repo, api, commerce, clock, A, B, sent, hooks };
}

async function connectGhl(deps: CrmDeps, api: FakeHighLevel, licenseId: string, locationId: string) {
  const state = await startConnection(deps, licenseId);
  return completeConnection(deps, { state, code: api.issueCode(locationId), redirectUri: REDIRECT });
}

async function enable(deps: CrmDeps, licenseId: string, over = {}) {
  await deps.repo.saveLeadSettings({ license_id: licenseId, enabled: true, business_name: "Biz", lead_source: "Monarch Tax Calculator", tags: ["calc-lead"], update_existing: false, include_summary: true, ...over });
}

const lead = (deps: CrmDeps, licenseId: string, host: string | null, over: Partial<LeadSubmission> = {}): LeadSubmission => ({
  token: issueEmbedToken(deps, licenseId, host),
  submissionId: randomUUID(),
  firstName: "Jamie",
  lastName: "Rivera",
  email: "jamie@example.com",
  phone: "",
  consent: true,
  summary: { taxYear: 2026, filingStatus: "single", result: "refund", amount: 2880 },
  ...over,
});

/** Everything Monarch persisted for CRM purposes, as text, to prove no lead data is kept. */
const stored = (repo: MemoryCrmRepo) => JSON.stringify({ c: repo.connections, s: repo.settings, l: repo.log, o: repo.states });

describe("direct delivery: no lead data retained", () => {
  test("webhook: lead reaches the buyer's URL, signed, and Monarch keeps no personal data", async () => {
    const { deps, repo, A, sent } = setup();
    const { signingSecret } = await setWebhook(deps, A.id, "https://hooks.buyer-a.com/in");
    await enable(deps, A.id);
    const sub = lead(deps, A.id, "buyer-a.com");
    assert.deepEqual(await forwardLead(deps, sub, { ip: "203.0.113.5" }), { ok: true });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, "https://hooks.buyer-a.com/in");
    assert.equal(sent[0].secret, signingSecret);
    assert.equal(sent[0].key, sub.submissionId, "idempotency key = submission id");
    assert.deepEqual(sent[0].body.contact, { first_name: "Jamie", last_name: "Rivera", email: "jamie@example.com", phone: null });
    const persisted = stored(repo);
    for (const pii of ["Jamie", "Rivera", "jamie@example.com", "2880", "203.0.113.5", "hooks.buyer-a.com/in", signingSecret]) assert.ok(!persisted.includes(pii), `${pii} not stored`);
    assert.equal(repo.log[0].outcome, "sent");
    assert.match(repo.connections[0].webhook_url_enc!, /^v1:/);
  });

  test("HighLevel: lead becomes a contact in the buyer's own location; nothing stored", async () => {
    const { deps, repo, api, A } = setup();
    await connectGhl(deps, api, A.id, "locAAAAAAAA");
    await enable(deps, A.id);
    assert.deepEqual(await forwardLead(deps, lead(deps, A.id, "buyer-a.com"), { ip: "203.0.113.5" }), { ok: true });
    assert.equal(api.contacts.length, 1);
    assert.equal(api.contacts[0].locationId, "locAAAAAAAA");
    assert.deepEqual(api.contacts[0].tags, ["calc-lead"]);
    assert.match(api.contacts[0].notes[0], /Estimated refund: \$2,880/);
    assert.ok(!stored(repo).includes("jamie@example.com"));
  });

  test("failed delivery returns a retryable error, stores nothing, and the visitor's retry is not duplicated", async () => {
    const { deps, repo, A, sent, hooks } = setup();
    await setWebhook(deps, A.id, "https://hooks.buyer-a.com/in");
    await enable(deps, A.id);
    hooks.fail = 1;
    const sub = lead(deps, A.id, "buyer-a.com");
    assert.deepEqual(await forwardLead(deps, sub, { ip: "203.0.113.5" }), { ok: false, reason: "destination_failed", retryable: true });
    assert.equal(sent.length, 0);
    assert.ok(!stored(repo).includes("jamie@example.com"));
    assert.equal(repo.log[0].outcome, "failed");
    // The browser retries with the same submission id; the destination receives the same idempotency key.
    assert.deepEqual(await forwardLead(deps, sub, { ip: "203.0.113.5" }), { ok: true });
    assert.equal(sent[0].key, sub.submissionId);
  });

  test("HighLevel retry after a partial failure finds the existing contact (no duplicate)", async () => {
    const { deps, api, A } = setup();
    await connectGhl(deps, api, A.id, "locAAAAAAAA");
    await enable(deps, A.id);
    api.failures.push({ op: "addNote", error: new HighLevelError("HighLevel responded 503", "retryable", 503) });
    const sub = lead(deps, A.id, "buyer-a.com");
    assert.equal((await forwardLead(deps, sub, { ip: "203.0.113.5" })).ok, false);
    assert.equal((await forwardLead(deps, sub, { ip: "203.0.113.5" })).ok, true);
    assert.equal(api.contacts.length, 1);
    assert.equal(api.contacts[0].notes.length, 1);
  });

  test("expired tokens are refreshed; revoked access requires reconnecting and the visitor gets an error", async () => {
    const { deps, repo, api, clock, A } = setup();
    await connectGhl(deps, api, A.id, "locAAAAAAAA");
    await enable(deps, A.id);
    clock.t += 25 * 3600_000;
    assert.equal((await forwardLead(deps, lead(deps, A.id, "buyer-a.com"), { ip: "203.0.113.1" })).ok, true);
    assert.equal(api.calls.filter((c) => c === "refresh").length, 1);
    api.revoke("locAAAAAAAA");
    clock.t += 25 * 3600_000;
    assert.deepEqual(await forwardLead(deps, lead(deps, A.id, "buyer-a.com"), { ip: "203.0.113.2" }), { ok: false, reason: "destination_failed", retryable: true });
    assert.equal(repo.connections[0].status, "reauth_required");
    // While reauthorization is needed the form is not offered.
    assert.deepEqual(await forwardLead(deps, lead(deps, A.id, "buyer-a.com"), { ip: "203.0.113.3" }), { ok: false, reason: "unavailable", retryable: false });
  });

  test("concurrent refreshes never spend one refresh token twice", async () => {
    const { deps, repo, api, clock, A } = setup();
    const conn = await connectGhl(deps, api, A.id, "locAAAAAAAA");
    clock.t += 25 * 3600_000;
    const call = (token: string) => api.getLocation(token, "locAAAAAAAA");
    await Promise.allSettled([withAccessToken(deps, conn, call), withAccessToken(deps, conn, call)]);
    assert.equal(api.calls.filter((c) => c === "refresh").length, 1);
    assert.equal(repo.connections[0].status, "connected");
  });
});

describe("tenant isolation", () => {
  test("two buyers, two destinations: each lead goes only to its own buyer", async () => {
    const { deps, api, A, B, sent } = setup();
    await connectGhl(deps, api, A.id, "locAAAAAAAA");
    await setWebhook(deps, B.id, "https://hooks.buyer-b.com/in");
    await enable(deps, A.id);
    await enable(deps, B.id);
    await forwardLead(deps, lead(deps, A.id, "buyer-a.com", { email: "a@example.com" }), { ip: "203.0.113.5" });
    await forwardLead(deps, lead(deps, B.id, "buyer-b.com", { email: "b@example.com" }), { ip: "198.51.100.7" });
    assert.deepEqual(api.contacts.map((c) => c.email), ["a@example.com"]);
    assert.deepEqual(sent.map((s) => (s.body.contact as { email: string }).email), ["b@example.com"]);
  });

  test("a token cannot be altered to target another buyer, and OAuth state cannot be replayed", async () => {
    const { deps, api, A, B, sent } = setup();
    await setWebhook(deps, B.id, "https://hooks.buyer-b.com/in");
    await enable(deps, B.id);
    const [body, mac] = issueEmbedToken(deps, A.id, "buyer-a.com").split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), l: B.id })).toString("base64url") + "." + mac;
    await assert.rejects(forwardLead(deps, { ...lead(deps, A.id, null), token: forged }, { ip: null }), /expired/);
    assert.equal(sent.length, 0);
    const state = await startConnection(deps, A.id);
    await completeConnection(deps, { state, code: api.issueCode("locAAAAAAAA"), redirectUri: REDIRECT });
    await assert.rejects(completeConnection(deps, { state, code: api.issueCode("locBBBBBBBB"), redirectUri: REDIRECT }), /already used/);
  });

  test("credentials are encrypted and bound to their own license", async () => {
    const { deps, repo, api, A, B } = setup();
    const a = await connectGhl(deps, api, A.id, "locAAAAAAAA");
    await setWebhook(deps, B.id, "https://hooks.buyer-b.com/in");
    assert.ok(!stored(repo).includes("at_") && !stored(repo).includes("rt_"), "no plaintext tokens");
    assert.throws(() => deps.secrets!.decrypt(a.access_token_enc!, `crm:${B.id}:locAAAAAAAA:access`));
    const b = repo.connections.find((c) => c.license_id === B.id)!;
    assert.throws(() => deps.secrets!.decrypt(b.webhook_url_enc!, `webhook:${A.id}:url`));
  });

  test("unlicensed, inactive or unauthorized-domain installs cannot use any destination", async () => {
    const { deps, commerce, A, sent } = setup();
    await setWebhook(deps, A.id, "https://hooks.buyer-a.com/in");
    await enable(deps, A.id);
    assert.deepEqual(await forwardLead(deps, lead(deps, A.id, "evil.example"), { ip: null }), { ok: false, reason: "unavailable", retryable: false });
    commerce.licenses.find((l) => l.id === A.id)!.status = "suspended";
    assert.deepEqual(await forwardLead(deps, lead(deps, A.id, "buyer-a.com"), { ip: null }), { ok: false, reason: "unavailable", retryable: false });
    await assert.rejects(setWebhook(deps, A.id, "https://hooks.buyer-a.com/x"), /active calculator license/);
    assert.equal(sent.length, 0);
  });

  test("a buyer with no destination never falls back to anyone else's", async () => {
    const { deps, api, A, B } = setup();
    await connectGhl(deps, api, A.id, "locAAAAAAAA");
    await enable(deps, A.id);
    await enable(deps, B.id);
    assert.deepEqual(await forwardLead(deps, lead(deps, B.id, "buyer-b.com"), { ip: null }), { ok: false, reason: "unavailable", retryable: false });
    assert.equal(api.contacts.length, 0);
  });

  test("disconnect deletes credentials, turns the form off and stops delivery", async () => {
    const { deps, repo, A, sent } = setup();
    await setWebhook(deps, A.id, "https://hooks.buyer-a.com/in");
    await enable(deps, A.id);
    assert.ok(await disconnect(deps, A.id));
    const c = repo.connections[0];
    assert.equal(c.status, "disconnected");
    assert.equal(c.webhook_url_enc, null);
    assert.equal(c.signing_secret_enc, null);
    assert.equal((await repo.getLeadSettings(A.id))!.enabled, false);
    assert.deepEqual(await forwardLead(deps, lead(deps, A.id, "buyer-a.com"), { ip: null }), { ok: false, reason: "unavailable", retryable: false });
    assert.equal(sent.length, 0);
  });
});

describe("configuration, validation and abuse", () => {
  test("no HighLevel app needed: webhooks work without HighLevel credentials", async () => {
    const { deps, A, sent } = setup();
    const noGhl = { ...deps, api: null };
    await assert.rejects(startConnection(noGhl, A.id), /not available yet/);
    await setWebhook(noGhl, A.id, "https://hooks.buyer-a.com/in");
    await enable(noGhl, A.id);
    assert.equal((await forwardLead(noGhl, lead(noGhl, A.id, "buyer-a.com"), { ip: null })).ok, true);
    assert.equal(sent.length, 1);
    assert.equal((await testDestination(noGhl, A.id)).ok, true);
    assert.equal((sent[1].body as { event: string }).event, "calculator.test", "test event carries no lead data");
  });

  test("webhook URLs must be public HTTPS", () => {
    for (const bad of ["http://hooks.example.com", "https://127.0.0.1/x", "https://localhost/x", "https://user:pw@hooks.example.com", "https://hooks.example.com:8443/x", "https://intranet/x", "not a url"]) {
      assert.throws(() => parseWebhookUrl(bad), ValidationError, bad);
    }
    assert.equal(parseWebhookUrl("https://hooks.zapier.com/hooks/catch/1/abc/#x").toString(), "https://hooks.zapier.com/hooks/catch/1/abc/");
    for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.5.4", "192.168.1.1", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) assert.ok(isPrivateAddress(ip), ip);
    for (const ip of ["8.8.8.8", "34.120.1.1", "2606:4700::1111"]) assert.ok(!isPrivateAddress(ip), ip);
  });

  test("webhook signatures can be verified by the receiver", () => {
    const body = JSON.stringify({ a: 1 });
    const expected = `v1=${createHmac("sha256", "whsec_x").update(`1700000000.${body}`).digest("hex")}`;
    assert.equal(signWebhook("whsec_x", 1700000000, body), expected);
  });

  test("visitor input validation", () => {
    const opts = { years: [2026, 2025], includeSummary: true, now: new Date() };
    const base: LeadSubmission = { token: "", submissionId: randomUUID(), firstName: "A", email: "a@b.co", consent: true };
    assert.throws(() => parseLead({ ...base, firstName: " " }, opts), /first name/);
    assert.throws(() => parseLead({ ...base, email: "", phone: "" }, opts), /email address or phone/);
    assert.throws(() => parseLead({ ...base, consent: "true" }, opts), /agree/);
    assert.throws(() => parseLead({ ...base, submissionId: "x" }, opts), /Invalid submission/);
    assert.equal(parseLead({ ...base, summary: { taxYear: 2030, filingStatus: "single", result: "refund", amount: 1 } }, opts).summary, null);
  });

  test("honeypot and rate limits; the log keeps only a keyed IP hash, cleared after 24 hours", async () => {
    const { deps, repo, clock, A, sent } = setup();
    await setWebhook(deps, A.id, "https://hooks.buyer-a.com/in");
    await enable(deps, A.id);
    assert.deepEqual(await forwardLead(deps, lead(deps, A.id, "buyer-a.com", { website: "spam" }), { ip: "203.0.113.9" }), { ok: true });
    assert.equal(sent.length, 0);
    for (let i = 0; i < 5; i++) await forwardLead(deps, lead(deps, A.id, "buyer-a.com"), { ip: "203.0.113.2" });
    assert.deepEqual(await forwardLead(deps, lead(deps, A.id, "buyer-a.com"), { ip: "203.0.113.2" }), { ok: false, reason: "rate_limited", retryable: false });
    assert.ok(repo.log.every((l) => !l.ip_hash || !l.ip_hash.includes("203")));
    for (const l of repo.log) l.created_at = new Date(clock.t - 2 * 86_400_000).toISOString();
    clock.t += 1;
    await forwardLead(deps, lead(deps, A.id, "buyer-a.com"), { ip: "198.51.100.1" });
    assert.ok(repo.log.filter((l) => l.created_at < new Date(clock.t - 86_400_000).toISOString()).every((l) => l.ip_hash === null));
  });
});

describe("pending customer (previous Stripe account)", () => {
  test("manual reconciliation → license key → authorized domain → working calculator embed", async () => {
    const repo = new MemoryRepo();
    const product = await createProduct(repo, {
      slug: "monarch-basic-tax-calculator", name: "Monarch Basic Tax Calculator", description: null, product_type: "software", access_type: "license",
      installation_options: ["self_service", "done_for_you"], price_cents: 7500, currency: "usd", stripe_product_id: "prod_CURRENT0001", stripe_price_id: null, status: "draft",
    });
    await repo.createVersion({ product_id: product.id, tax_year: 2026, label: "2026", status: "available", release_date: null, update_price_cents: 5000, stripe_update_price_id: null });
    const input = {
      email: "buyer@example.com", full_name: null, payment_intent_id: "pi_3UOS6UPos8bgFzRf2VneOiqn", amount_cents: 7500, currency: "usd", product_id: product.id,
      installation_type: "done_for_you" as const, platform: "other" as const, platform_other: null, website_url: null, target_location: null,
      notes: "Paid in a previous Stripe account (not Monarch's current account); verified manually by an administrator.", admin_id: "admin-1", stripe_payment: null,
    };
    await assert.rejects(reconcilePurchase(repo, { ...input, admin_attested: false }), /verified this payment/);
    assert.equal(repo.orders.length, 0, "not recorded without the administrator's confirmation");
    const result = await reconcilePurchase(repo, { ...input, admin_attested: true });
    assert.equal(result.order.verification_method, "admin_manual");
    assert.equal(result.order.payment_status, "paid");
    const { key } = await issueLicenseKey(repo, result.license!.id, "admin-1");
    const licensed = (await repo.findLicenseByKeyHash(hashLicenseKey(key)))!;
    assert.equal(licensed.status, "active");
    assert.deepEqual(licensedYears(licensed), [2026, 2025]);
    await authorizeDomain(repo, licensed.id, "buyer-site.com", "admin-1");
    assert.equal(decideEmbed(licensed, await repo.listDomains(licensed.id), "buyer-site.com").ok, true);
    assert.equal(decideEmbed(licensed, await repo.listDomains(licensed.id), "other-site.com").ok, false);
  });
});
