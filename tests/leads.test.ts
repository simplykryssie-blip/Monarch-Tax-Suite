import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { captureAuditLead, captureAuditStart, checkPhone, convertFromPurchase, createLead, dayStart, exportCsv, filterFrom, importCsv, markContacted, updateLead } from "../lib/leads/service.ts";
import { parseCsv } from "../lib/leads/csv.ts";
import { parseTags } from "../lib/leads/tags.ts";
import { MemoryLeads } from "./leads-memory.ts";

// Leads: one person is one lead, captured from the WISP audit, converted when they buy, and worked by hand.

const ADMIN = "00000000-0000-4000-8000-00000000ad01";
const setup = () => {
  const repo = new MemoryLeads();
  let clock = new Date("2026-10-13T15:00:00Z");
  repo.clock = () => clock;
  return { repo, deps: { repo, now: () => clock }, set: (iso: string) => { clock = new Date(iso); } };
};

describe("WISP audit lead capture", () => {
  test("the first step (name, email, phone) creates the lead before the questions; finishing adds the score", async () => {
    const s = setup();
    const lead = await captureAuditStart(s.deps, { name: "Pat Preparer", email: "Pat@Example.com", phone: " (337) 555-0100 " });
    assert.deepEqual([lead.email, lead.phone, lead.source, lead.status, lead.audit_score], ["pat@example.com", "(337) 555-0100", "wisp_audit", "new", null]);
    const done = await captureAuditLead(s.deps, { name: "Pat Preparer", email: "pat@example.com", phone: "(337) 555-0100" }, { id: "audit-1", score: 64 });
    assert.equal(done.id, lead.id);
    assert.deepEqual([done.audit_id, done.audit_score], ["audit-1", 64]);
    assert.deepEqual(s.repo.events.map((e) => [e.action, e.detail.started ?? e.detail.score]), [["created", true], ["audit_taken", 64]]);
  });

  test("phone is required and must look like a phone number; an existing lead keeps its phone", async () => {
    const s = setup();
    await assert.rejects(captureAuditStart(s.deps, { name: "Pat", email: "p@example.com", phone: "" }), /valid phone/);
    await assert.rejects(captureAuditStart(s.deps, { name: "Pat", email: "p@example.com", phone: "555-0100" }), /valid phone/);
    await assert.rejects(captureAuditStart(s.deps, { name: "Pat", email: "p@example.com", phone: "call me maybe 3375550100" }), /valid phone/);
    assert.equal(checkPhone("+1 337 555 0100"), "+1 337 555 0100");
    await createLead(s.deps, { full_name: "Kim", email: "kim@example.com", phone: "337-555-0001", source: "referral", status: "interested" }, ADMIN);
    const again = await captureAuditStart(s.deps, { name: "Kim L", email: "kim@example.com", phone: "337-555-9999" });
    assert.deepEqual([again.phone, again.source, again.status], ["337-555-0001", "referral", "interested"]);
    assert.equal(s.repo.events.at(-1)!.detail.phone_given, "337-555-9999");
    await createLead(s.deps, { full_name: "Lee", email: "lee@example.com", source: "manual" }, ADMIN);
    assert.equal((await captureAuditStart(s.deps, { name: "Lee", email: "lee@example.com", phone: "337-555-0002" })).phone, "337-555-0002", "a missing phone is filled in");
  });

  test("a finished audit with no saved start still creates the lead, with the score", async () => {
    const s = setup();
    const lead = await captureAuditLead(s.deps, { name: "  Pat   Preparer ", email: " Pat@Example.com " }, { id: "audit-1", score: 42 });
    assert.equal(lead.full_name, "Pat Preparer");
    assert.equal(lead.email, "pat@example.com");
    assert.equal(lead.source, "wisp_audit");
    assert.equal(lead.status, "new");
    assert.equal(lead.audit_score, 42);
    assert.equal(lead.audit_id, "audit-1");
    assert.deepEqual(s.repo.events.map((e) => e.action), ["created"]);
  });

  test("name and email are required", async () => {
    const s = setup();
    await assert.rejects(captureAuditLead(s.deps, { name: " ", email: "a@example.com" }, { id: "a", score: 1 }), /your name/);
    await assert.rejects(captureAuditLead(s.deps, { name: "Pat", email: "nope" }, { id: "a", score: 1 }), /valid email/);
    assert.equal(s.repo.leads.length, 0);
  });

  test("the same email taking the audit again is the same lead, with the newest score; status and source stay", async () => {
    const s = setup();
    const first = await createLead(s.deps, { full_name: "Pat", email: "pat@example.com", source: "facebook_group", status: "interested" }, ADMIN);
    const again = await captureAuditLead(s.deps, { name: "Pat P", email: "pat@example.com" }, { id: "audit-2", score: 77 });
    assert.equal(again.id, first.id);
    assert.equal(s.repo.leads.length, 1);
    assert.equal(again.source, "facebook_group");
    assert.equal(again.status, "interested");
    assert.equal(again.audit_score, 77);
    assert.deepEqual(s.repo.events.map((e) => e.action), ["created", "audit_taken"]);
  });

  test("buying the WISP links the lead to the customer and order and marks Converted, once", async () => {
    const s = setup();
    const lead = await captureAuditLead(s.deps, { name: "Pat", email: "pat@example.com" }, { id: "audit-1", score: 42 });
    // Paid with a different delivery email: the audit links them.
    const after = await convertFromPurchase(s.deps, { auditId: "audit-1", email: "office@pat.example", planId: "plan-1", customerId: "cust-1", orderId: "order-1" });
    assert.equal(after?.id, lead.id);
    assert.equal(after?.status, "converted");
    assert.equal(after?.customer_id, "cust-1");
    assert.equal(after?.order_id, "order-1");
    assert.equal(after?.wisp_plan_id, "plan-1");
    assert.ok(after?.converted_at);
    await convertFromPurchase(s.deps, { auditId: "audit-1", email: "office@pat.example", planId: "plan-1", customerId: "cust-1", orderId: "order-1" });
    assert.equal(s.repo.events.filter((e) => e.action === "converted").length, 1, "Stripe retries don't repeat it");
  });

  test("without an audit the buyer's email finds the lead; a buyer who was never a lead changes nothing", async () => {
    const s = setup();
    await createLead(s.deps, { full_name: "Sam", email: "sam@example.com", source: "referral" }, ADMIN);
    assert.equal((await convertFromPurchase(s.deps, { auditId: null, email: "SAM@example.com", planId: "p", customerId: "c", orderId: "o" }))?.status, "converted");
    assert.equal(await convertFromPurchase(s.deps, { auditId: null, email: "nobody@example.com", planId: "p", customerId: "c", orderId: "o2" }), null);
    assert.equal(s.repo.leads.length, 1);
  });
});

describe("working leads", () => {
  test("manual add checks the fields and refuses a second lead for the same email", async () => {
    const s = setup();
    const lead = await createLead(s.deps, { full_name: "Kim", email: "kim@example.com", phone: " (337) 555-0100 ", firm_name: "Kim Tax", source: "manual", notes: "Met at expo", last_contacted_at: "2026-10-10" }, ADMIN);
    assert.equal(lead.phone, "(337) 555-0100");
    assert.equal(lead.status, "new");
    assert.equal(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(lead.last_contacted_at!)), "2026-10-10");
    await assert.rejects(createLead(s.deps, { full_name: "Kim 2", email: "KIM@example.com", source: "manual" }, ADMIN), /already a lead/);
    await assert.rejects(createLead(s.deps, { full_name: "X", email: "x@example.com", source: "billboard" }, ADMIN), /came from/);
    await assert.rejects(createLead(s.deps, { full_name: "X", email: "x@example.com", source: "manual", status: "won" }, ADMIN), /status/);
    await assert.rejects(createLead(s.deps, { full_name: "X", email: "x@example.com", source: "manual", last_contacted_at: "10/45/2026" }, ADMIN), /valid date/);
  });

  test("edits, status changes, contacted today and the firm link are all in the history", async () => {
    const s = setup();
    const lead = await createLead(s.deps, { full_name: "Kim", email: "kim@example.com", source: "manual" }, ADMIN);
    const c = await markContacted(s.deps, lead.id, ADMIN);
    assert.equal(c.status, "contacted");
    assert.ok(c.last_contacted_at);
    const u = await updateLead(s.deps, lead.id, { full_name: "Kim Lee", email: "kim@example.com", source: "manual", status: "converted", notes: "Signed up" }, ADMIN);
    assert.equal(u.status, "converted");
    assert.ok(u.converted_at);
    assert.deepEqual(s.repo.events.map((e) => e.action), ["created", "contacted", "status_changed", "edited"]);
  });

  test("search and filters by source, status and date", async () => {
    const s = setup();
    s.set("2026-10-01T15:00:00Z");
    await createLead(s.deps, { full_name: "Ann", email: "ann@example.com", firm_name: "Bayou Tax", source: "referral" }, ADMIN);
    s.set("2026-10-12T03:30:00Z"); // the evening of Oct 11 in Eastern time
    await captureAuditLead(s.deps, { name: "Ben", email: "ben@example.com" }, { id: "a", score: 10 });
    const list = (sp: Record<string, string>) => s.repo.listLeads(filterFrom(sp)).then((r) => r.map((l) => l.full_name));
    assert.deepEqual(await list({ q: "bayou" }), ["Ann"]);
    assert.deepEqual(await list({ source: "wisp_audit" }), ["Ben"]);
    assert.deepEqual(await list({ status: "new" }), ["Ben", "Ann"]);
    assert.deepEqual(await list({ from: "2026-10-11", to: "2026-10-11" }), ["Ben"]);
    assert.deepEqual(await list({ to: "2026-10-10" }), ["Ann"]);
    assert.deepEqual(filterFrom({ source: "nope", status: "x", from: "yesterday" }), { q: undefined, source: undefined, status: undefined, from: undefined, to: undefined });
    assert.equal(dayStart("2026-10-11"), "2026-10-11T05:00:00.000Z");
  });
});

describe("CSV", () => {
  test("import matches columns by header, uses the chosen source, and skips existing and repeated emails", async () => {
    const s = setup();
    await createLead(s.deps, { full_name: "Old", email: "old@example.com", source: "manual" }, ADMIN);
    const csv = "﻿Full Name,E-mail,Phone,Company,Source,Status,Notes,Extra\r\n" +
      'Ann,ann@example.com,555,"Bayou Tax, LLC",Facebook group,Interested,"Said ""call me""\nnext week",x\r\n' +
      "Ben,ben@example.com,,,,,,\r\n" +
      "Old,old@example.com,,,,,,\r\n" +
      "Ben again,BEN@example.com,,,,,,\r\n" +
      ",nobody@example.com,,,,,,\r\n" +
      "Cy,cy@example.com,,,,Won,,\r\n" +
      ",,,,,,,\r\n";
    const r = await importCsv(s.deps, csv, "referral", ADMIN);
    assert.equal(r.added, 2);
    assert.deepEqual(r.skipped.map((x) => x.row), [4, 5, 6, 7]);
    assert.match(r.skipped[0].reason, /already a lead/);
    assert.match(r.skipped[1].reason, /more than once/);
    const ann = (await s.repo.findByEmail("ann@example.com"))!;
    assert.equal(ann.firm_name, "Bayou Tax, LLC");
    assert.equal(ann.source, "facebook_group");
    assert.equal(ann.status, "interested");
    assert.equal(ann.notes, 'Said "call me"\nnext week');
    assert.equal((await s.repo.findByEmail("ben@example.com"))!.source, "referral");
  });

  test("a file without Name and Email columns is refused", async () => {
    const s = setup();
    await assert.rejects(importCsv(s.deps, "Phone,Notes\n555,hi\n", "other", ADMIN), /Name and Email/);
    await assert.rejects(importCsv(s.deps, "Name,Email\n", "other", ADMIN), /no rows/);
  });

  test("export round-trips through import, and spreadsheet formulas are neutralised", async () => {
    const s = setup();
    await createLead(s.deps, { full_name: "=HYPERLINK(1)", email: "f@example.com", phone: "+1 337 555 0100", source: "website", status: "lost", last_contacted_at: "2026-10-02" }, ADMIN);
    const csv = exportCsv(await s.repo.listLeads({}));
    const rows = parseCsv(csv);
    assert.deepEqual(rows[0].slice(0, 6), ["Name", "Email", "Phone", "Firm", "Source", "Status"]);
    assert.equal(rows[1][0], "'=HYPERLINK(1)");
    assert.equal(rows[1][10], "2026-10-02");
    const fresh = setup();
    const r = await importCsv(fresh.deps, csv, "other", ADMIN);
    assert.equal(r.added, 1);
    const back = (await fresh.repo.findByEmail("f@example.com"))!;
    assert.equal(back.full_name, "=HYPERLINK(1)");
    assert.equal(back.phone, "+1 337 555 0100");
    assert.equal(back.source, "website");
    assert.equal(back.status, "lost");
  });

  test("semicolon files from European spreadsheet settings", () => {
    assert.deepEqual(parseCsv("Name;Email\nA;a@example.com"), [["Name", "Email"], ["A", "a@example.com"]]);
  });
});

describe("lead tags", () => {
  test("tags are tidied: lower case, no repeats, commas or new lines separate them", () => {
    assert.deepEqual(parseTags("  VIP , Facebook  Group,vip\nreferral <b>"), ["vip", "facebook group", "referral b"]);
    assert.deepEqual(parseTags(["EROs", "eros"]), ["eros"]);
    assert.deepEqual(parseTags(undefined), []);
  });

  test("a lead keeps its tags, and the list narrows to leads that carry every tag chosen", async () => {
    const s = setup();
    await createLead(s.deps, { full_name: "Ann", email: "ann@example.com", source: "referral", tags: "vip, eros" }, ADMIN);
    await createLead(s.deps, { full_name: "Ben", email: "ben@example.com", source: "manual", tags: ["vip"] }, ADMIN);
    await createLead(s.deps, { full_name: "Cy", email: "cy@example.com", source: "manual" }, ADMIN);
    const names = (sp: Record<string, string>) => s.repo.listLeads(filterFrom(sp)).then((r) => r.map((l) => l.full_name).sort());
    assert.deepEqual(await names({ tags: "vip" }), ["Ann", "Ben"]);
    assert.deepEqual(await names({ tags: "vip,eros" }), ["Ann"]);
    assert.deepEqual(await names({ tags: "vip", source: "manual" }), ["Ben"]);
    assert.deepEqual(await s.repo.tagCounts(), [{ tag: "vip", count: 2 }, { tag: "eros", count: 1 }]);
  });

  test("editing tags is recorded, and too many or too long are refused", async () => {
    const s = setup();
    const lead = await createLead(s.deps, { full_name: "Ann", email: "ann@example.com", source: "manual", tags: "vip" }, ADMIN);
    const u = await updateLead(s.deps, lead.id, { full_name: "Ann", email: "ann@example.com", source: "manual", tags: "vip, hot" }, ADMIN);
    assert.deepEqual(u.tags, ["vip", "hot"]);
    assert.deepEqual(s.repo.events.at(-1)?.detail, { fields: ["tags"] });
    await assert.rejects(createLead(s.deps, { full_name: "X", email: "x@example.com", source: "manual", tags: Array.from({ length: 13 }, (_, i) => `t${i}`) }, ADMIN), /up to 12 tags/);
    await assert.rejects(createLead(s.deps, { full_name: "Y", email: "y@example.com", source: "manual", tags: "x".repeat(41) }, ADMIN), /40 characters/);
  });

  test("CSV import reads a Tags column and export writes it", async () => {
    const s = setup();
    await importCsv(s.deps, 'Name,Email,Tags\nAnn,ann@example.com,"vip, eros"\n', "manual", ADMIN);
    assert.deepEqual((await s.repo.findByEmail("ann@example.com"))?.tags, ["vip", "eros"]);
    assert.match(exportCsv(await s.repo.listLeads({})), /"vip, eros"/);
  });
});

describe("WISP builder lead", () => {
  test("the builder's first step makes a lead with source WISP builder, and a repeat doesn't change it", async () => {
    const { captureBuilderStart } = await import("../lib/leads/service.ts");
    const s = setup();
    const lead = await captureBuilderStart(s.deps, { name: "Bayou Tax LLC", email: "Owner@Bayou.example.com", phone: "(337) 555-0100" });
    assert.equal(lead.source, "wisp_builder");
    assert.equal(lead.email, "owner@bayou.example.com");
    assert.equal(lead.status, "new");
    await captureBuilderStart(s.deps, { name: "Bayou Tax LLC", email: "owner@bayou.example.com", phone: "(337) 555-0100" });
    assert.equal((await s.repo.listLeads({})).length, 1);
    assert.deepEqual(s.repo.events.map((e) => e.action), ["created", "builder_started"]);
    await assert.rejects(captureBuilderStart(s.deps, { name: "X", email: "x@example.com", phone: "123" }), /valid phone/);
  });

  test("someone who already took the audit keeps their source and gets a missing phone filled in", async () => {
    const { captureBuilderStart } = await import("../lib/leads/service.ts");
    const s = setup();
    await captureAuditLead(s.deps, { name: "Ann", email: "ann@example.com" }, { id: "a", score: 40 });
    const after = await captureBuilderStart(s.deps, { name: "Ann Tax", email: "ann@example.com", phone: "337 555 0100" });
    assert.equal(after.source, "wisp_audit");
    assert.equal(after.phone, "337 555 0100");
  });
});
