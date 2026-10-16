import { test } from "node:test";
import assert from "node:assert/strict";
import { AlreadyRegisteredError, cleanAttribute, cleanDomain, ResendDomains } from "../lib/automation/senders.ts";

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
  await assert.rejects(new ResendDomains("re_test", restricted.impl).create("acmetax.test"), /full-access Resend API key/);
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
