import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { MemoryRepo } from "./memory-repo.ts";
import { FakeHighLevel, MemoryCrmRepo } from "./crm-memory.ts";
import { CrmSecrets } from "../lib/crm/crypto.ts";
import { HighLevelError } from "../lib/crm/highlevel.ts";
import { completeConnection, disconnect, setWebhook, startConnection, type CrmDeps } from "../lib/crm/connection.ts";
import { leadCaptureActive } from "../lib/crm/leads.ts";
import { activateDomain, assertCanEnable, deriveSetupStatus, hasPassedTest, normalizeMainDomain, previewActivation, runConnectionTest } from "../lib/crm/setup.ts";
import { allowedHosts } from "../lib/commerce/embed.ts";
import { ValidationError } from "../lib/commerce/validation.ts";
import type { License } from "../lib/commerce/types.ts";
import type { WebhookSender } from "../lib/crm/webhook.ts";

const REDIRECT = "https://monarch.test/api/integrations/crm/callback";

function license(over: Partial<License> = {}): License {
  const id = randomUUID();
  return {
    id, customer_id: randomUUID(), order_id: randomUUID(), product_id: randomUUID(), key_hash: "a".repeat(64), key_prefix: "MTS-AAAAA", embed_id: `emb_${id.slice(0, 20)}`,
    original_tax_year: 2026, licensed_tax_year: 2026, status: "active", max_domains: 1, issued_at: null, activated_at: null, revoked_at: null, revoke_reason: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over,
  };
}

function setup() {
  const commerce = new MemoryRepo();
  const repo = new MemoryCrmRepo();
  const api = new FakeHighLevel();
  api.addLocation("locAAAAAAAA", "Buyer A Tax Co");
  api.addLocation("locBBBBBBBB", "Buyer B Accounting");
  const hooks = { ok: true };
  const webhook: WebhookSender = async () => (hooks.ok ? { ok: true, status: 200 } : { ok: false, status: 503, reason: "http_error" });
  const deps: CrmDeps = { repo, commerce, api, secrets: new CrmSecrets(randomBytes(32)), webhook, sleep: async () => undefined };
  const A = license();
  const B = license();
  commerce.licenses.push(A, B);
  return { deps, repo, api, commerce, A, B, hooks };
}

async function connect(deps: CrmDeps, api: FakeHighLevel, licenseId: string, loc: string) {
  const state = await startConnection(deps, licenseId);
  return completeConnection(deps, { state, code: api.issueCode(loc), redirectUri: REDIRECT });
}

describe("step 1: activation and domain normalization", () => {
  test("a page address becomes the main domain", () => {
    assert.equal(normalizeMainDomain("https://www.MKBFinancialGroup.com/calculator?x=1"), "mkbfinancialgroup.com");
    assert.equal(normalizeMainDomain("example.org/some/page"), "example.org");
  });
  test("rejects junk, IPs, single labels and shared hosting addresses", () => {
    for (const bad of ["", "not a domain", "localhost", "127.0.0.1", "http://192.168.1.5/x", "app.vercel.app", "shop.myshopify.com", "x.leadconnectorhq.com", "funnel.gohighlevel.com"]) {
      assert.throws(() => normalizeMainDomain(bad), ValidationError, bad);
    }
  });
  test("preview changes nothing; confirm authorizes the domain and its www twin", async () => {
    const { commerce, A } = setup();
    const p = await previewActivation(commerce, A.id, "https://www.shop.com/page");
    assert.deepEqual(p, { domain: "shop.com", alsoCovers: "www.shop.com", alreadyActive: false });
    assert.equal((await commerce.listDomains(A.id)).length, 0);
    await activateDomain(commerce, A.id, "https://www.shop.com/page");
    const active = (await commerce.listDomains(A.id)).filter((d) => d.status === "active");
    assert.deepEqual(active.map((d) => d.domain), ["shop.com"]);
    assert.deepEqual(allowedHosts(active).sort(), ["shop.com", "www.shop.com"]);
    assert.ok((await commerce.getLicense(A.id))!.activated_at);
  });
  test("activating again is a no-op; a second different domain is refused at the license limit", async () => {
    const { commerce, A } = setup();
    await activateDomain(commerce, A.id, "shop.com");
    assert.equal((await activateDomain(commerce, A.id, "www.shop.com")).alreadyActive, true);
    await assert.rejects(() => activateDomain(commerce, A.id, "other.com"), /already activated for shop\.com/);
    assert.equal((await commerce.listDomains(A.id)).filter((d) => d.status === "active").length, 1);
  });
  test("inactive or unknown licenses cannot be activated, and one customer cannot touch another's", async () => {
    const { commerce, A, B } = setup();
    commerce.licenses.push(license({ status: "revoked" }));
    await assert.rejects(() => activateDomain(commerce, commerce.licenses[2].id, "x.com"), ValidationError);
    await assert.rejects(() => activateDomain(commerce, randomUUID(), "x.com"), ValidationError);
    await activateDomain(commerce, A.id, "a.com");
    assert.equal((await commerce.listDomains(B.id)).length, 0);
  });
});

describe("status never overstates success", () => {
  const conn = (o: object) => ({ provider: "webhook" as const, status: "connected" as const, last_checked_at: null, last_error: null, ...o });
  test("each state", () => {
    assert.equal(deriveSetupStatus({ connection: null, settings: null }).key, "not_connected");
    assert.equal(deriveSetupStatus({ connection: conn({ status: "disconnected" }), settings: null }).key, "not_connected");
    assert.equal(deriveSetupStatus({ connection: conn({}), settings: null }).key, "connected");
    assert.equal(deriveSetupStatus({ connection: conn({ last_checked_at: "t", last_error: "x" }), settings: null }).key, "test_failed");
    assert.equal(deriveSetupStatus({ connection: conn({ status: "reauth_required" }), settings: null }).key, "reauth_needed");
    assert.equal(deriveSetupStatus({ connection: conn({ last_checked_at: "t" }), settings: { enabled: false } }).key, "test_successful");
    assert.equal(deriveSetupStatus({ connection: conn({ last_checked_at: "t" }), settings: { enabled: true } }).key, "lead_capture_enabled");
  });
  test("a saved webhook is 'connected, not tested', never successful", async () => {
    const { deps, A } = setup();
    const { connection } = await setWebhook(deps, A.id, "https://hooks.example.com/abc");
    const s = deriveSetupStatus({ connection, settings: null });
    assert.equal(s.key, "connected");
    assert.match(s.label, /not tested/);
    assert.equal(hasPassedTest(connection), false);
  });
});

describe("step 3: testing and enabling", () => {
  test("lead capture cannot be enabled before a passed test", async () => {
    const { deps, A } = setup();
    assert.throws(() => assertCanEnable(null, false), ValidationError);
    await setWebhook(deps, A.id, "https://hooks.example.com/abc");
    const c = (await deps.repo.getLiveConnection(A.id))!;
    assert.throws(() => assertCanEnable(c, false), /Test connection/);
    assert.doesNotThrow(() => assertCanEnable(c, true)); // already on: not forced off
  });
  test("webhook test success enables, failure blocks", async () => {
    const { deps, A, hooks } = setup();
    await setWebhook(deps, A.id, "https://hooks.example.com/abc");
    hooks.ok = false;
    const bad = await runConnectionTest(deps, A.id);
    assert.equal(bad.ok, false);
    const failed = (await deps.repo.getLiveConnection(A.id))!;
    assert.equal(deriveSetupStatus({ connection: failed, settings: null }).key, "test_failed");
    assert.throws(() => assertCanEnable(failed, false), ValidationError);
    hooks.ok = true;
    const good = await runConnectionTest(deps, A.id);
    assert.equal(good.ok, true);
    assert.match(good.message, /your own automation/); // does not claim a contact or email was made
    const passed = (await deps.repo.getLiveConnection(A.id))!;
    assert.equal(hasPassedTest(passed), true);
    assert.doesNotThrow(() => assertCanEnable(passed, false));
  });
  test("a GoHighLevel connection is not 'tested' until the test runs; the test adds one labelled contact, once", async () => {
    const { deps, api, A } = setup();
    const c = await connect(deps, api, A.id, "locAAAAAAAA");
    assert.equal(c.last_checked_at, null);
    assert.equal(deriveSetupStatus({ connection: c, settings: null }).key, "connected");
    const r1 = await runConnectionTest(deps, A.id);
    assert.equal(r1.ok, true);
    assert.match(r1.message, /Buyer A Tax Co/);
    assert.match(r1.message, /No email or text was sent/);
    await runConnectionTest(deps, A.id);
    assert.equal(api.contacts.length, 1);
    assert.deepEqual(api.contacts[0].tags, ["monarch-test"]);
    assert.equal(api.contacts[0].locationId, "locAAAAAAAA");
    assert.equal(api.contacts[0].phone, undefined);
    assert.equal(hasPassedTest((await deps.repo.getLiveConnection(A.id))!), true);
  });
  test("revoked or expired GoHighLevel access fails plainly and asks to reconnect", async () => {
    const { deps, api, A } = setup();
    await connect(deps, api, A.id, "locAAAAAAAA");
    api.revoke("locAAAAAAAA");
    const r = await runConnectionTest(deps, A.id);
    assert.equal(r.ok, false);
    assert.match(r.message, /Reconnect/);
    const after = (await deps.repo.getLiveConnection(A.id))!;
    assert.notEqual(deriveSetupStatus({ connection: after, settings: null }).key, "test_successful");
    assert.equal(hasPassedTest(after), false);
    assert.equal((await runConnectionTest(deps, A.id)).ok, false);
  });
  test("a failed contact step is a failed test, with no raw API error shown", async () => {
    const { deps, api, A } = setup();
    await connect(deps, api, A.id, "locAAAAAAAA");
    api.failures.push({ op: "createContact", error: new HighLevelError("HighLevel responded 422: secret detail", "permanent", 422) });
    const r = await runConnectionTest(deps, A.id);
    assert.equal(r.ok, false);
    assert.doesNotMatch(r.message, /422|secret detail/);
    assert.equal(hasPassedTest((await deps.repo.getLiveConnection(A.id))!), false);
  });
  test("no connection: test says to connect first", async () => {
    const { deps, A } = setup();
    assert.deepEqual(await runConnectionTest(deps, A.id), { ok: false, message: "Connect your CRM first." });
  });
});

describe("isolation and credentials", () => {
  test("two customers' connections and test contacts stay separate", async () => {
    const { deps, api, A, B } = setup();
    await connect(deps, api, A.id, "locAAAAAAAA");
    await connect(deps, api, B.id, "locBBBBBBBB");
    await runConnectionTest(deps, A.id);
    assert.equal(api.contacts.filter((c) => c.locationId === "locBBBBBBBB").length, 0);
    assert.equal(hasPassedTest((await deps.repo.getLiveConnection(B.id))!), false);
    await runConnectionTest(deps, B.id);
    assert.deepEqual(api.contacts.map((c) => c.locationId).sort(), ["locAAAAAAAA", "locBBBBBBBB"]);
  });
  test("tokens are stored encrypted, bound to their license", async () => {
    const { deps, api, A, B } = setup();
    const c = await connect(deps, api, A.id, "locAAAAAAAA");
    assert.ok(c.access_token_enc && !c.access_token_enc.includes("at_"));
    assert.ok(c.refresh_token_enc && !c.refresh_token_enc.includes("rt_"));
    const bConn = await connect(deps, api, B.id, "locBBBBBBBB");
    assert.throws(() => deps.secrets!.decrypt(c.access_token_enc!, `crm:${B.id}:${bConn.location_id}:access`));
    const { connection } = await setWebhook(deps, B.id, "https://hooks.example.com/secret-path");
    assert.ok(!connection.webhook_url_enc!.includes("secret-path"));
  });
});

describe("lead form visibility", () => {
  const settings = (id: string, over = {}) => ({ license_id: id, enabled: true, business_name: "Biz", lead_source: "x", tags: [], update_existing: false, include_summary: true, ...over });
  test("hidden before configuration, shown after connect + enable, hidden again after disconnect", async () => {
    const { deps, api, A } = setup();
    assert.equal(await leadCaptureActive(deps, A.id), null);
    await connect(deps, api, A.id, "locAAAAAAAA");
    assert.equal(await leadCaptureActive(deps, A.id), null); // connected but form not enabled
    await deps.repo.saveLeadSettings(settings(A.id));
    assert.ok(await leadCaptureActive(deps, A.id));
    await disconnect(deps, A.id);
    assert.equal(await leadCaptureActive(deps, A.id), null);
    assert.equal((await deps.repo.getLeadSettings(A.id))!.enabled, false);
  });
  test("hidden when the connection needs reconnecting", async () => {
    const { deps, api, A } = setup();
    const c = await connect(deps, api, A.id, "locAAAAAAAA");
    await deps.repo.saveLeadSettings(settings(A.id));
    await deps.repo.updateConnection(c.id, { status: "reauth_required" });
    assert.equal(await leadCaptureActive(deps, A.id), null);
  });
});
