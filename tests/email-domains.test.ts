import { test } from "node:test";
import assert from "node:assert/strict";
import { addSender, AlreadyRegisteredError, cleanAttribute, cleanDomain, removeDomain, ResendDomains, type SendersRepo } from "../lib/automation/senders.ts";

// Sending domains with the email provider (Resend), against a fake API. No real requests are made.

function fakeFetch(routes: Record<string, { status: number; body: unknown }>) {
  const calls: string[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(url).replace("https://api.resend.com", "")}`;
    calls.push(key);
    const r = routes[key] ?? { status: 404, body: { message: "not found" } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { impl, calls };
}

test("adding a domain returns its DNS records; status and records are mapped", async () => {
  const f = fakeFetch({ "POST /domains": { status: 200, body: { id: "dom_1", status: "not_started", records: [{ record: "SPF", type: "TXT", name: "send", value: "v=spf1 include:amazonses.com ~all" }] } } });
  const d = await new ResendDomains("re_test", f.impl).create("mail.acmetax.test");
  assert.deepEqual(d, { id: "dom_1", status: "pending", records: [{ record: "SPF", type: "TXT", name: "send", value: "v=spf1 include:amazonses.com ~all", priority: null, status: null }] });
});

test("a sending-only key, and a domain registered elsewhere, give clear answers", async () => {
  const restricted = fakeFetch({ "POST /domains": { status: 401, body: { message: "restricted" } } });
  await assert.rejects(new ResendDomains("re_test", restricted.impl, "RESEND_SECRET_KEY").create("acmetax.test"), /RESEND_SECRET_KEY.*Full access/);
  const invalid = fakeFetch({ "POST /domains": { status: 403, body: { message: "API key is invalid" } } });
  await assert.rejects(new ResendDomains("re_test", invalid.impl, "RESEND_API_KEY").create("acmetax.test"), /RESEND_API_KEY is not valid \(403\).*re_/);
  const dup403 = fakeFetch({ "POST /domains": { status: 403, body: { message: "The domain has been registered already" } } });
  await assert.rejects(new ResendDomains("re_test", dup403.impl).create("acmetax.test"), (e) => e instanceof AlreadyRegisteredError, "a 403 that says the domain exists is not a key problem");
  const taken = fakeFetch({ "POST /domains": { status: 409, body: { message: "already exists" } } });
  await assert.rejects(new ResendDomains("re_test", taken.impl).create("acmetax.test"), (e) => e instanceof AlreadyRegisteredError);
  await assert.rejects(new ResendDomains(null).create("acmetax.test"), /not configured/);
});

test("the platform can find a domain already on its own account", async () => {
  const f = fakeFetch({
    "GET /domains": { status: 200, body: { data: [{ id: "dom_9", name: "monarchtaxsuite.com" }] } },
    "GET /domains/dom_9": { status: 200, body: { id: "dom_9", status: "verified", records: [] } },
  });
  assert.equal((await new ResendDomains("re_test", f.impl).findByName("monarchtaxsuite.com"))?.status, "verified");
});

test("domain and attribute input is cleaned", () => {
  assert.equal(cleanDomain("https://Mail.AcmeTax.test/"), "mail.acmetax.test");
  assert.throws(() => cleanDomain("office@acmetax.test"), /Enter your domain/);
  assert.deepEqual(cleanAttribute({ key: "Flow_Type", label: "Flow type", kind: "choice", options: "ptin_holder, standard_ero, ptin_holder" }), { key: "flow_type", label: "Flow type", kind: "choice", options: ["ptin_holder", "standard_ero"] });
  assert.throws(() => cleanAttribute({ key: "1bad", label: "Bad", kind: "choice", options: "a,b" }), /lowercase letters/);
  assert.throws(() => cleanAttribute({ key: "tier", label: "Tier", kind: "choice", options: "only" }), /at least two options/);
});

function memoryRepo() {
  const domains = [{ id: "d1", domain: "mkbfinancialgroup.com" }];
  const senders: { id: string; domain_id: string; local_part: string; archived_at: string | null }[] = [];
  const repo = {
    getDomain: async (id: string) => domains.find((d) => d.id === id) ?? null,
    listSenders: async () => senders,
    deleteSender: async (id: string) => { senders.splice(senders.findIndex((s) => s.id === id), 1); },
    deleteDomain: async (id: string) => { domains.splice(domains.findIndex((d) => d.id === id), 1); },
  } as unknown as SendersRepo;
  return { repo, domains, senders };
}

test("a domain can be disconnected so it can be added again, unless something still uses it", async () => {
  const m = memoryRepo();
  m.senders.push({ id: "s1", domain_id: "d1", local_part: "support", archived_at: null });
  await assert.rejects(removeDomain(m.repo, "d1", { formNames: [], templateNames: [] }), /support@mkbfinancialgroup\.com.*Remove them first/);
  m.senders[0].archived_at = "2026-10-16T00:00:00Z";
  await assert.rejects(removeDomain(m.repo, "d1", { formNames: ["ERO application"], templateNames: [] }), /is the firm for 1 form \(ERO application\)/);
  await assert.rejects(removeDomain(m.repo, "d1", { formNames: [], templateNames: ["Welcome"] }), /used by 1 email template/);
  assert.equal(m.domains.length, 1, "nothing was removed while refused");
  assert.equal(await removeDomain(m.repo, "d1", { formNames: [], templateNames: [] }), "mkbfinancialgroup.com");
  assert.equal(m.domains.length, 0);
  assert.equal(m.senders.length, 0, "its archived addresses go with it");
  await assert.rejects(removeDomain(m.repo, "d1", { formNames: [], templateNames: [] }), /Not found/);
});

test("a removed sending address can be added back; a live one says so", async () => {
  const rows: { id: string; domain_id: string; local_part: string; from_name: string; reply_to: string | null; archived_at: string | null }[] = [];
  const repo = {
    getDomain: async () => ({ id: "d1", domain: "mkbfinancialgroup.com" }),
    listSenders: async () => rows,
    insertSender: async (i: { domain_id: string; local_part: string; from_name: string; reply_to: string | null }) => { const r = { id: `s${rows.length + 1}`, archived_at: null, ...i }; rows.push(r); return r; },
    updateSender: async (id: string, patch: Partial<(typeof rows)[number]>) => Object.assign(rows.find((r) => r.id === id)!, patch),
  } as unknown as SendersRepo;
  const input = { domain_id: "d1", local_part: "support", from_name: "MKB Support", reply_to: null, created_by: "u" };
  const first = await addSender(repo, input);
  assert.equal(first.restored, false);
  await assert.rejects(addSender(repo, input), /support@mkbfinancialgroup\.com is already one of your sending addresses/);
  rows[0].archived_at = "2026-10-16T00:00:00Z";
  const again = await addSender(repo, { ...input, from_name: "MKB Financial Support" });
  assert.equal(again.restored, true);
  assert.equal(again.sender.id, first.sender.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].archived_at, null);
  assert.equal(rows[0].from_name, "MKB Financial Support");
});
