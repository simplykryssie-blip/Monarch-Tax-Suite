import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { MemoryRepo } from "./memory-repo.ts";
import { FakeHighLevel, MemoryCrmRepo } from "./crm-memory.ts";
import { CrmSecrets } from "../lib/crm/crypto.ts";
import { HighLevelError } from "../lib/crm/highlevel.ts";
import { completeConnection, disconnect, startConnection, testConnection, withAccessToken, type CrmDeps } from "../lib/crm/connection.ts";
import { deliverLead, issueEmbedToken, parseLead, processDueLeads, purgeLeads, readLeadDetails, submitLead, type LeadSubmission } from "../lib/crm/leads.ts";
import { ValidationError } from "../lib/commerce/validation.ts";
import type { License } from "../lib/commerce/types.ts";

const REDIRECT = "https://monarch.test/api/integrations/crm/callback";

function license(id: string, customer: string, over: Partial<License> = {}): License {
  return {
    id, customer_id: customer, order_id: randomUUID(), product_id: randomUUID(), key_hash: "a".repeat(64), key_prefix: "MTS-AAAAA", embed_id: `emb_${id.slice(0, 20)}`,
    original_tax_year: 2026, licensed_tax_year: 2026, status: "active", max_domains: 3, issued_at: null, activated_at: null, revoked_at: null, revoke_reason: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over,
  };
}

function setup() {
  const commerce = new MemoryRepo();
  const repo = new MemoryCrmRepo();
  const api = new FakeHighLevel();
  api.addLocation("locAAAAAAAA", "Buyer A Tax Co");
  api.addLocation("locBBBBBBBB", "Buyer B Accounting");
  const clock = { t: Date.now() };
  const deps: CrmDeps = { repo, commerce, api, secrets: new CrmSecrets(randomBytes(32)), now: () => new Date(clock.t), sleep: async () => undefined };
  const A = license(randomUUID(), randomUUID());
  const B = license(randomUUID(), randomUUID());
  commerce.licenses.push(A, B);
  commerce.domains.push(
    { id: randomUUID(), license_id: A.id, domain: "buyer-a.com", status: "active", created_at: "" },
    { id: randomUUID(), license_id: B.id, domain: "buyer-b.com", status: "active", created_at: "" },
  );
  return { deps, repo, api, commerce, clock, A, B };
}

async function connect(deps: CrmDeps, api: FakeHighLevel, licenseId: string, locationId: string) {
  const state = await startConnection(deps, licenseId);
  return completeConnection(deps, { licenseId, state, code: api.issueCode(locationId), redirectUri: REDIRECT });
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

async function submitAndDeliver(deps: CrmDeps, input: LeadSubmission, ip = "203.0.113.5") {
  const result = await submitLead(deps, input, { ip });
  assert.equal(result.accepted, true);
  if (result.accepted && result.leadId) await deliverLead(deps, result.leadId);
  return result;
}

describe("buyer connections (scenarios 1-2, 7, 11)", () => {
  test("each buyer connects their own location; tokens are stored encrypted only", async () => {
    const { deps, repo, api, A, B } = setup();
    const a = await connect(deps, api, A.id, "locAAAAAAAA");
    const b = await connect(deps, api, B.id, "locBBBBBBBB");
    assert.equal(a.location_name, "Buyer A Tax Co");
    assert.equal(b.location_id, "locBBBBBBBB");
    assert.equal(a.status, "connected");
    for (const c of repo.connections) {
      assert.match(c.access_token_enc!, /^v1:/);
      assert.ok(!JSON.stringify(c).includes("at_") && !JSON.stringify(c).includes("rt_"), "no plaintext tokens stored");
    }
    // Ciphertext is bound to its own license/location: moving it to another tenant fails to decrypt.
    assert.throws(() => deps.secrets!.decrypt(a.access_token_enc!, `crm:${B.id}:locBBBBBBBB:access`));
  });

  test("OAuth state is single-use, expires, and is bound to the license that started it", async () => {
    const { deps, api, clock, A, B } = setup();
    const state = await startConnection(deps, A.id);
    await assert.rejects(completeConnection(deps, { licenseId: B.id, state, code: api.issueCode("locBBBBBBBB"), redirectUri: REDIRECT }), /expired or was already used/);
    await completeConnection(deps, { licenseId: A.id, state, code: api.issueCode("locAAAAAAAA"), redirectUri: REDIRECT });
    await assert.rejects(completeConnection(deps, { licenseId: A.id, state, code: api.issueCode("locAAAAAAAA"), redirectUri: REDIRECT }), /already used/);
    const late = await startConnection(deps, A.id);
    clock.t += 11 * 60_000;
    await assert.rejects(completeConnection(deps, { licenseId: A.id, state: late, code: api.issueCode("locAAAAAAAA"), redirectUri: REDIRECT }), /expired/);
  });

  test("agency (Company) authorizations and inactive licenses are refused", async () => {
    const { deps, api, commerce, A, B } = setup();
    const state = await startConnection(deps, A.id);
    await assert.rejects(completeConnection(deps, { licenseId: A.id, state, code: api.issueCode("locAAAAAAAA", "Company"), redirectUri: REDIRECT }), /sub-account/);
    commerce.licenses.find((l) => l.id === B.id)!.status = "suspended";
    await assert.rejects(startConnection(deps, B.id), /active calculator license/);
  });

  test("not configured: nothing can connect and no lead form token is issued", async () => {
    const { deps, A } = setup();
    await assert.rejects(startConnection({ ...deps, api: null }, A.id), /not configured/);
    assert.throws(() => issueEmbedToken({ ...deps, secrets: null }, A.id, null), /not configured/);
  });

  test("changing location replaces the old connection (its credentials are deleted)", async () => {
    const { deps, repo, api, A } = setup();
    const first = await connect(deps, api, A.id, "locAAAAAAAA");
    api.addLocation("locA2AAAAAA", "Buyer A Second Office");
    const second = await connect(deps, api, A.id, "locA2AAAAAA");
    const old = repo.connections.find((c) => c.id === first.id)!;
    assert.equal(old.status, "disconnected");
    assert.equal(old.access_token_enc, null);
    assert.equal((await repo.getLiveConnection(A.id))!.id, second.id);
  });
});

describe("lead delivery (scenarios 3-8)", () => {
  test("leads reach only the buyer's own location", async () => {
    const { deps, api, A, B } = setup();
    await connect(deps, api, A.id, "locAAAAAAAA");
    await connect(deps, api, B.id, "locBBBBBBBB");
    await enable(deps, A.id);
    await enable(deps, B.id);
    await submitAndDeliver(deps, lead(deps, A.id, "buyer-a.com", { email: "a-visitor@example.com" }));
    await submitAndDeliver(deps, lead(deps, B.id, "buyer-b.com", { email: "b-visitor@example.com" }), "198.51.100.7");
    const inA = api.contacts.filter((c) => c.locationId === "locAAAAAAAA");
    const inB = api.contacts.filter((c) => c.locationId === "locBBBBBBBB");
    assert.deepEqual(inA.map((c) => c.email), ["a-visitor@example.com"]);
    assert.deepEqual(inB.map((c) => c.email), ["b-visitor@example.com"]);
    assert.deepEqual(inA[0].tags, ["calc-lead"]);
    assert.match(inA[0].notes[0], /Tax year: 2026 · Filing status: Single\nEstimated refund: \$2,880/);
    assert.equal(inA[0].source, "Monarch Tax Calculator");
  });

  test("delivered leads keep no contact details; history shows a masked email", async () => {
    const { deps, repo, api, A } = setup();
    await connect(deps, api, A.id, "locAAAAAAAA");
    await enable(deps, A.id);
    await submitAndDeliver(deps, lead(deps, A.id, "buyer-a.com"));
    const [row] = repo.leads;
    assert.equal(row.status, "sent");
    assert.equal(row.payload_enc, null);
    assert.equal(row.email_masked, "j***@example.com");
    assert.ok(row.ghl_contact_id);
    assert.ok((await repo.getLiveConnection(A.id))!.last_success_at);
  });

  test("a token for one buyer cannot be altered to target another", async () => {
    const { deps, api, A, B } = setup();
    await connect(deps, api, A.id, "locAAAAAAAA");
    await connect(deps, api, B.id, "locBBBBBBBB");
    await enable(deps, A.id);
    await enable(deps, B.id);
    const token = issueEmbedToken(deps, A.id, "buyer-a.com");
    const [body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), l: B.id })).toString("base64url") + "." + mac;
    await assert.rejects(submitLead(deps, { ...lead(deps, A.id, null), token: forged }, { ip: null }), /expired/);
    await assert.rejects(submitLead(deps, { ...lead(deps, A.id, null), token: "garbage" }, { ip: null }), ValidationError);
    assert.equal(api.contacts.length, 0);
  });

  test("repeat submissions do not duplicate contacts", async () => {
    const { deps, repo, api, A } = setup();
    await connect(deps, api, A.id, "locAAAAAAAA");
    await enable(deps, A.id);
    const first = lead(deps, A.id, "buyer-a.com");
    await submitAndDeliver(deps, first);
    // Double-submit of the same form: same submission id, one lead.
    const again = await submitLead(deps, first, { ip: "203.0.113.5" });
    assert.equal(again.accepted && again.leadId, repo.leads[0].id);
    // Same visitor later, new submission: existing contact found, not recreated or overwritten.
    await submitAndDeliver(deps, lead(deps, A.id, "buyer-a.com", { firstName: "Changed" }));
    assert.equal(api.contacts.length, 1);
    assert.equal(api.contacts[0].firstName, "Jamie", "existing contact left unchanged");
    assert.equal(repo.leads[1].contact_created, false);
    assert.equal(api.contacts[0].notes.length, 2, "each estimate is added as a note");
  });

  test("update-existing mode uses HighLevel upsert", async () => {
    const { deps, api, A } = setup();
    await connect(deps, api, A.id, "locAAAAAAAA");
    await enable(deps, A.id, { update_existing: true });
    await submitAndDeliver(deps, lead(deps, A.id, "buyer-a.com"));
    await submitAndDeliver(deps, lead(deps, A.id, "buyer-a.com", { firstName: "Jamie-Lee" }));
    assert.equal(api.contacts.length, 1);
    assert.equal(api.contacts[0].firstName, "Jamie-Lee");
    assert.ok(api.calls.includes("upsertContact"));
  });

  test("only supplied fields are sent; summary omitted when the buyer turned it off", async () => {
    const { deps, api, A } = setup();
    await connect(deps, api, A.id, "locAAAAAAAA");
    await enable(deps, A.id, { include_summary: false, tags: [] });
    await submitAndDeliver(deps, lead(deps, A.id, "buyer-a.com", { lastName: "", email: "", phone: "(555) 010-2233" }));
    const [c] = api.contacts;
    assert.equal(c.lastName, undefined);
    assert.equal(c.email, undefined);
    assert.equal(c.phone, "5550102233");
    assert.deepEqual(c.notes, []);
    assert.ok(!api.calls.includes("addTags"));
  });
});

describe("tokens, retries and failures (scenarios 9-10)", () => {
  test("expired access tokens are refreshed once (single-use refresh tokens rotate)", async () => {
    const { deps, repo, api, clock, A } = setup();
    await connect(deps, api, A.id, "locAAAAAAAA");
    await enable(deps, A.id);
    clock.t += 25 * 3600_000; // past the 24h expiry
    const before = repo.connections[0].refresh_token_enc;
    await submitAndDeliver(deps, lead(deps, A.id, "buyer-a.com"));
    assert.equal(api.calls.filter((c) => c === "refresh").length, 1);
    assert.notEqual(repo.connections[0].refresh_token_enc, before);
    assert.equal(repo.leads[0].status, "sent");
  });

  test("a rejected token is refreshed and the call retried", async () => {
    const { deps, api, A } = setup();
    await connect(deps, api, A.id, "locAAAAAAAA");
    api.expireAccessTokens("locAAAAAAAA");
    assert.deepEqual(await testConnection(deps, A.id), { ok: true, message: "Connected to Buyer A Tax Co." });
  });

  test("revoked authorization requires reconnection; held leads deliver after reconnecting", async () => {
    const { deps, repo, api, A } = setup();
    await connect(deps, api, A.id, "locAAAAAAAA");
    await enable(deps, A.id);
    api.revoke("locAAAAAAAA");
    await submitAndDeliver(deps, lead(deps, A.id, "buyer-a.com"));
    assert.equal(repo.connections[0].status, "reauth_required");
    assert.equal(repo.leads[0].status, "reauth_required");
    assert.equal((await testConnection(deps, A.id)).ok, false);
    // Form still accepts leads while waiting; they are held.
    await submitLead(deps, lead(deps, A.id, "buyer-a.com", { email: "second@example.com" }), { ip: "203.0.113.9" });
    assert.equal(repo.leads[1].status, "reauth_required");
    await connect(deps, api, A.id, "locAAAAAAAA");
    await processDueLeads(deps, { licenseId: A.id });
    assert.deepEqual(repo.leads.map((l) => l.status), ["sent", "sent"]);
    assert.equal(api.contacts.length, 2);
  });

  test("concurrent refreshes never spend the same refresh token twice", async () => {
    const { deps, repo, api, clock, A } = setup();
    const conn = await connect(deps, api, A.id, "locAAAAAAAA");
    clock.t += 25 * 3600_000;
    const call = (token: string) => api.getLocation(token, "locAAAAAAAA");
    const results = await Promise.allSettled([withAccessToken(deps, conn, call), withAccessToken(deps, conn, call)]);
    assert.equal(api.calls.filter((c) => c === "refresh").length, 1);
    assert.ok(results.some((r) => r.status === "fulfilled"));
    assert.equal(repo.connections[0].status, "connected", "the waiting request did not mark the connection broken");
  });

  test("temporary failures retry with backoff without duplicating the contact", async () => {
    const { deps, repo, api, clock, A } = setup();
    await connect(deps, api, A.id, "locAAAAAAAA");
    await enable(deps, A.id);
    api.failures.push({ op: "createContact", error: new HighLevelError("HighLevel responded 429", "retryable", 429) });
    api.failures.push({ op: "addNote", error: new HighLevelError("HighLevel responded 503", "retryable", 503) });
    await submitAndDeliver(deps, lead(deps, A.id, "buyer-a.com"));
    assert.equal(repo.leads[0].status, "retry_pending");
    assert.equal(repo.leads[0].last_error, "HighLevel responded 429");
    await processDueLeads(deps); // not due yet
    assert.equal(repo.leads[0].attempts, 1);
    clock.t += 60_000;
    await processDueLeads(deps); // contact + tags succeed, note fails
    assert.equal(repo.leads[0].status, "retry_pending");
    assert.ok(repo.leads[0].ghl_contact_id);
    clock.t += 5 * 60_000;
    await processDueLeads(deps);
    assert.equal(repo.leads[0].status, "sent");
    assert.equal(api.contacts.length, 1);
    assert.equal(api.contacts[0].notes.length, 1);
    assert.equal(api.calls.filter((c) => c === "addTags").length, 1, "tags applied once");
  });

  test("permanent errors and exhausted retries are recorded as failed, details kept for the buyer", async () => {
    const { deps, repo, api, clock, A } = setup();
    await connect(deps, api, A.id, "locAAAAAAAA");
    await enable(deps, A.id);
    api.failures.push({ op: "createContact", error: new HighLevelError("HighLevel responded 422: invalid phone", "permanent", 422) });
    await submitAndDeliver(deps, lead(deps, A.id, "buyer-a.com"));
    assert.equal(repo.leads[0].status, "failed");
    assert.equal(readLeadDetails(deps, repo.leads[0])?.email, "jamie@example.com");
    for (let i = 0; i < 8; i++) api.failures.push({ op: "createContact", error: new HighLevelError("HighLevel responded 500", "retryable", 500) });
    await submitAndDeliver(deps, lead(deps, A.id, "buyer-a.com", { email: "x@example.com" }), "203.0.113.77");
    for (let i = 0; i < 10; i++) {
      clock.t += 25 * 3600_000;
      await processDueLeads(deps);
    }
    assert.equal(repo.leads[1].status, "failed");
    assert.equal(repo.leads[1].attempts, 8);
  });
});

describe("unauthorized use and disconnection (scenarios 11-12)", () => {
  test("inactive license, unauthorized website or disabled capture: no lead accepted", async () => {
    const { deps, commerce, api, A } = setup();
    await connect(deps, api, A.id, "locAAAAAAAA");
    await enable(deps, A.id);
    assert.deepEqual(await submitLead(deps, lead(deps, A.id, "evil.example"), { ip: null }), { accepted: false, reason: "unavailable" });
    await enable(deps, A.id, { enabled: false });
    assert.deepEqual(await submitLead(deps, lead(deps, A.id, "buyer-a.com"), { ip: null }), { accepted: false, reason: "unavailable" });
    await enable(deps, A.id);
    commerce.licenses.find((l) => l.id === A.id)!.status = "suspended";
    assert.deepEqual(await submitLead(deps, lead(deps, A.id, "buyer-a.com"), { ip: null }), { accepted: false, reason: "unavailable" });
    assert.equal(api.contacts.length, 0);
  });

  test("a buyer without a connection never falls back to anyone else's", async () => {
    const { deps, api, A, B } = setup();
    await connect(deps, api, A.id, "locAAAAAAAA");
    await enable(deps, A.id);
    await enable(deps, B.id); // B enabled but never connected
    assert.deepEqual(await submitLead(deps, lead(deps, B.id, "buyer-b.com"), { ip: null }), { accepted: false, reason: "unavailable" });
    assert.equal(api.contacts.length, 0);
  });

  test("disconnecting deletes credentials, stops deliveries and turns the form off", async () => {
    const { deps, repo, api, A } = setup();
    await connect(deps, api, A.id, "locAAAAAAAA");
    await enable(deps, A.id);
    const pending = await submitLead(deps, lead(deps, A.id, "buyer-a.com"), { ip: "203.0.113.5" });
    assert.ok(await disconnect(deps, A.id));
    const conn = repo.connections[0];
    assert.equal(conn.status, "disconnected");
    assert.equal(conn.access_token_enc, null);
    assert.equal(conn.refresh_token_enc, null);
    assert.equal(repo.leads[0].status, "failed");
    assert.equal((await repo.getLeadSettings(A.id))!.enabled, false);
    if (pending.accepted && pending.leadId) assert.equal(await deliverLead(deps, pending.leadId), null);
    assert.deepEqual(await submitLead(deps, lead(deps, A.id, "buyer-a.com"), { ip: null }), { accepted: false, reason: "unavailable" });
    assert.equal(api.contacts.length, 0);
  });
});

describe("input, abuse and retention", () => {
  test("visitor input validation", () => {
    const opts = { years: [2026, 2025], includeSummary: true, now: new Date() };
    const base: LeadSubmission = { token: "", submissionId: "", firstName: "A", email: "a@b.co", consent: true };
    assert.throws(() => parseLead({ ...base, firstName: " " }, opts), /first name/);
    assert.throws(() => parseLead({ ...base, email: "", phone: "" }, opts), /email address or phone/);
    assert.throws(() => parseLead({ ...base, email: "nope" }, opts), /valid email/);
    assert.throws(() => parseLead({ ...base, phone: "12" }, opts), /valid phone/);
    assert.throws(() => parseLead({ ...base, consent: "true" }, opts), /agree/);
    assert.equal(parseLead({ ...base, firstName: "<script>Al</script>" }, opts).firstName, "script Al /script");
    assert.equal(parseLead({ ...base, summary: { taxYear: 2030, filingStatus: "single", result: "refund", amount: 1 } }, opts).summary, null, "unlicensed tax year dropped");
  });

  test("honeypot submissions are dropped and per-visitor rate limits apply", async () => {
    const { deps, repo, api, A } = setup();
    await connect(deps, api, A.id, "locAAAAAAAA");
    await enable(deps, A.id);
    assert.deepEqual(await submitLead(deps, lead(deps, A.id, "buyer-a.com", { website: "http://spam" }), { ip: "203.0.113.1" }), { accepted: true, leadId: null });
    assert.equal(repo.leads.length, 0);
    for (let i = 0; i < 5; i++) await submitLead(deps, lead(deps, A.id, "buyer-a.com"), { ip: "203.0.113.2" });
    assert.deepEqual(await submitLead(deps, lead(deps, A.id, "buyer-a.com"), { ip: "203.0.113.2" }), { accepted: false, reason: "rate_limited" });
    assert.ok(repo.leads.every((l) => l.ip_hash && !l.ip_hash.includes("203.0")), "IP stored only as a keyed hash");
  });

  test("undelivered details are removed after 30 days", async () => {
    const { deps, repo, api, clock, A } = setup();
    await connect(deps, api, A.id, "locAAAAAAAA");
    await enable(deps, A.id);
    api.revoke("locAAAAAAAA");
    await submitAndDeliver(deps, lead(deps, A.id, "buyer-a.com"));
    repo.leads[0].created_at = new Date(clock.t - 31 * 86_400_000).toISOString();
    await purgeLeads(deps);
    assert.equal(repo.leads[0].payload_enc, null);
    assert.equal(repo.leads[0].ip_hash, null);
    assert.equal(repo.leads[0].status, "failed");
  });

  test("signed values reject tampering, other purposes and expiry", () => {
    const s = new CrmSecrets(randomBytes(32));
    const token = s.sign("portal-session", { l: "x", e: Math.floor(Date.now() / 1000) + 60 });
    assert.ok(s.verify("portal-session", token));
    assert.equal(s.verify("embed-token", token), null, "a portal session is not an embed token");
    assert.equal(s.verify("portal-session", token, Date.now() + 120_000), null);
    assert.equal(new CrmSecrets(randomBytes(32)).verify("portal-session", token), null);
  });
});
