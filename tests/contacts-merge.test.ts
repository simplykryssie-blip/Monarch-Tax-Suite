import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mergePlan } from "../lib/contacts/merge-plan.ts";
import type { Contact } from "../lib/contacts/combine.ts";
import { mergeLeads } from "../lib/leads/service.ts";
import { ValidationError } from "../lib/commerce/validation.ts";
import { MemoryLeads } from "./leads-memory.ts";

const contact = (refs: Partial<Contact["refs"]>): Contact => ({ key: "x", name: "X", email: null, phone: null, kinds: [], chips: [], active: true, tags: [], refs: { leadId: null, clientId: null, customerIds: [], ...refs }, lastActivity: null, assignedTo: null, leadStatus: null });

describe("what a pair of possible duplicates can be merged into", () => {
  test("two clients merge, a lead folds into a client, two leads fold together", () => {
    assert.deepEqual(mergePlan(contact({ clientId: "c1" }), contact({ clientId: "c2" })), { kind: "clients", a: "c1", b: "c2" });
    assert.deepEqual(mergePlan(contact({ leadId: "l1" }), contact({ clientId: "c2" })), { kind: "lead_into_client", clientId: "c2", leadId: "l1" });
    assert.deepEqual(mergePlan(contact({ clientId: "c1" }), contact({ leadId: "l2" })), { kind: "lead_into_client", clientId: "c1", leadId: "l2" });
    assert.deepEqual(mergePlan(contact({ leadId: "l1" }), contact({ leadId: "l2" })), { kind: "leads", a: "l1", b: "l2" });
  });
  test("a store customer on its own is never merged here", () => {
    assert.equal(mergePlan(contact({ customerIds: ["u1"] }), contact({ leadId: "l2" })), null);
    assert.equal(mergePlan(contact({ customerIds: ["u1"] }), contact({ clientId: "c2" })), null);
  });
});

describe("merging two leads", () => {
  const seed = async () => {
    const repo = new MemoryLeads();
    const base = { tags: [] as string[], notes: null, phone: null, firm_name: null, status: "new" as const, source: "manual" as const, last_contacted_at: null, audit_id: null, audit_score: null, wisp_plan_id: null, customer_id: null, order_id: null, organization_id: null, converted_at: null };
    const keep = await repo.insertLead({ ...base, full_name: "Ana Ruiz", email: "ana@example.com", tags: ["a"] });
    const drop = await repo.insertLead({ ...base, full_name: "Ana R", email: "ana2@example.com", phone: "3375550100", tags: ["b"], notes: "Wants a call" });
    return { repo, keep, drop };
  };
  test("details move over, the other is marked Lost, and both record it", async () => {
    const { repo, keep, drop } = await seed();
    const after = await mergeLeads({ repo } as never, keep.id, drop.id, "actor");
    assert.equal(after.phone, "3375550100");
    assert.deepEqual(after.tags, ["a", "b"]);
    assert.match(after.notes ?? "", /Merged from lead Ana R[\s\S]*ana2@example.com[\s\S]*Wants a call/);
    assert.equal((await repo.getLead(drop.id))?.status, "lost");
    assert.deepEqual(repo.events.map((e) => e.action).sort(), ["merged", "merged_into"]);
  });
  test("the same lead twice, or a missing lead, is refused", async () => {
    const { repo, keep } = await seed();
    await assert.rejects(() => mergeLeads({ repo } as never, keep.id, keep.id, "a"), ValidationError);
    await assert.rejects(() => mergeLeads({ repo } as never, keep.id, "00000000-0000-4000-8000-000000000000", "a"), ValidationError);
  });
});

import { recordCounts } from "../lib/contacts/record-counts.ts";
import { MemoryWorkspace } from "./workspace-memory.ts";

describe("comparing how much two client records hold", () => {
  test("counts what a client has, and nothing for a contact that is not a client", async () => {
    const repo = new MemoryWorkspace();
    const c = await repo.insertClient({ full_name: "Ana Ruiz", email: "a@example.com", phone: null, created_by: null } as never);
    await repo.insertNote({ client_id: c.id, body: "one", created_by: null });
    await repo.insertNote({ client_id: c.id, body: "two", created_by: null });
    const got = await recordCounts(repo, contact({ clientId: c.id }));
    assert.equal(got.find((x) => x.label === "Notes")?.n, 2);
    assert.equal(got.find((x) => x.label === "Returns")?.n, 0);
    assert.deepEqual(await recordCounts(repo, contact({ leadId: "l1" })), []);
  });
});

import { mergeClients } from "../lib/workspace/service.ts";

describe("merging two clients keeps what differs", () => {
  test("a different email and phone go into a note, tags are combined, and the owner carries over", async () => {
    const repo = new MemoryWorkspace();
    const keep = await repo.insertClient({ full_name: "Ana Ruiz", email: "ana@a.com", phone: "(337) 555-0100", created_by: null, tags: ["vip"] } as never);
    const drop = await repo.insertClient({ full_name: "Ana R Ruiz", email: "ana@b.com", phone: "337-555-0100", created_by: null, tags: ["referral"], owner_id: "22222222-2222-4222-8222-222222222222" } as never);
    await mergeClients(repo, keep.id, drop.id);
    const notes = await repo.listNotes(keep.id);
    assert.equal(notes.length, 1);
    assert.match(notes[0].body, /Other email: ana@b.com/);
    assert.match(notes[0].body, /Name: Ana R Ruiz/);
    assert.doesNotMatch(notes[0].body, /Other phone/);
    const after = await repo.getClient(keep.id);
    assert.deepEqual(after?.tags, ["referral", "vip"]);
    assert.equal(after?.owner_id, "22222222-2222-4222-8222-222222222222");
  });
  test("when nothing differs, no note is added", async () => {
    const repo = new MemoryWorkspace();
    const keep = await repo.insertClient({ full_name: "Ana Ruiz", email: "ana@a.com", phone: null, created_by: null } as never);
    const drop = await repo.insertClient({ full_name: "Ana Ruiz", email: "ana@a.com", phone: "3375550100", created_by: null } as never);
    await mergeClients(repo, keep.id, drop.id);
    assert.equal((await repo.listNotes(keep.id)).length, 0);
  });
});

import { combineContacts, possibleDuplicates } from "../lib/contacts/combine.ts";

describe("a merged record is no longer offered as a duplicate", () => {
  test("an archived client and a lost lead drop out of the possible duplicates", () => {
    const base = { phone: null, tags: [] as string[], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
    const client = (id: string, archived: string | null) => ({ ...base, id, full_name: "Ana Ruiz", email: "ana@example.com", archived_at: archived, owner_id: null }) as never;
    const live = combineContacts({ clients: [client("11111111-1111-4111-8111-111111111111", null), client("22222222-2222-4222-8222-222222222222", null)], leads: [], customers: [] } as never);
    const merged = combineContacts({ clients: [client("11111111-1111-4111-8111-111111111111", null), client("22222222-2222-4222-8222-222222222222", "2026-10-28T00:00:00Z")], leads: [], customers: [] } as never);
    assert.equal(possibleDuplicates(live).length, 1);
    assert.equal(possibleDuplicates(merged).length, 0);
  });
});

import { sameName } from "../lib/contacts/combine.ts";

describe("what counts as the same name", () => {
  test("first and last must match, and middle names that both have must start the same", () => {
    assert.equal(sameName("Ana Ruiz", "ana  RUIZ"), true);
    assert.equal(sameName("Ana Ruiz", "Ana Maria Ruiz"), true);
    assert.equal(sameName("Ana Maria Ruiz", "Ana M. Ruiz"), true);
    assert.equal(sameName("Merge Entry Person", "Merge Pair Person"), false);
    assert.equal(sameName("Ana Ruiz", "Ana Cruz"), false);
    assert.equal(sameName("Ana", "Ana Ruiz"), false);
  });
});

import { saveLeadNotesAndTags } from "../lib/leads/service.ts";

describe("saving a lead's notes and tags from its contact page", () => {
  test("only notes and tags change, the change is recorded, and a bad tag is refused", async () => {
    const repo = new MemoryLeads();
    const lead = await repo.insertLead({ tags: [], notes: null, phone: null, firm_name: null, status: "contacted", source: "manual", last_contacted_at: null, audit_id: null, audit_score: null, wisp_plan_id: null, customer_id: null, order_id: null, organization_id: null, converted_at: null, full_name: "Ana Ruiz", email: "ana@example.com" } as never);
    const after = await saveLeadNotesAndTags({ repo } as never, lead.id, { notes: "  Call after Friday  ", tags: "vip, referral" }, "actor");
    assert.equal(after.notes, "Call after Friday");
    assert.deepEqual([...after.tags].sort(), ["referral", "vip"]);
    assert.equal(after.status, "contacted");
    assert.equal(repo.events.filter((e) => e.action === "edited").length, 1);
    const cleared = await saveLeadNotesAndTags({ repo } as never, lead.id, { notes: "", tags: "" }, "actor");
    assert.equal(cleared.notes, null);
    await assert.rejects(() => saveLeadNotesAndTags({ repo } as never, lead.id, { notes: "x", tags: "a".repeat(80) }, "actor"));
  });
});

import { pairOf, withoutDismissed } from "../lib/contacts/dismissals.ts";

describe("pairs marked not a duplicate", () => {
  test("the pair is the same whichever way round, and is left out of the list", () => {
    assert.deepEqual(pairOf("lead-b", "client-a"), ["client-a", "lead-b"]);
    const pairs = [{ a: "client-a", b: "lead-b", reason: "same_name" as const }, { a: "client-a", b: "lead-c", reason: "shared_email" as const }];
    assert.deepEqual(withoutDismissed(pairs, [{ key_a: "client-a", key_b: "lead-b" }]).map((p) => p.b), ["lead-c"]);
    assert.deepEqual(withoutDismissed(pairs, [{ key_a: "lead-b", key_b: "client-a" }]).map((p) => p.b), ["lead-c"]);
    assert.equal(withoutDismissed(pairs, []).length, 2);
  });
});

import { convertLeadToClient } from "../lib/contacts/convert.ts";

describe("converting a lead into a client", () => {
  const seed = async (over: Record<string, unknown> = {}) => {
    const leads = new MemoryLeads();
    const lead = await leads.insertLead({ tags: ["referral"], notes: "Wants bookkeeping", phone: "3375550100", firm_name: "Guillory LLC", status: "interested", source: "manual", last_contacted_at: null, audit_id: null, audit_score: null, wisp_plan_id: null, customer_id: null, order_id: null, organization_id: null, converted_at: null, full_name: "Tanika Guillory", email: "tanika@example.com", assigned_to: "22222222-2222-4222-8222-222222222222", ...over } as never);
    return { leads, lead, repo: new MemoryWorkspace() };
  };
  test("makes the client with the lead's details, writes the rest as a note, and marks the lead converted", async () => {
    const { leads, lead, repo } = await seed();
    const { client, alreadyClient } = await convertLeadToClient(repo, { repo: leads } as never, lead.id, { id: "u1" });
    assert.equal(alreadyClient, false);
    assert.equal(client.full_name, "Tanika Guillory");
    assert.equal(client.email, "tanika@example.com");
    const saved = (await repo.getClient(client.id))!;
    assert.deepEqual(saved.tags, ["referral"]);
    assert.equal(saved.owner_id, "22222222-2222-4222-8222-222222222222");
    const notes = await repo.listNotes(client.id);
    assert.match(notes[0].body, /Firm: Guillory LLC[\s\S]*Wants bookkeeping/);
    const after = (await leads.getLead(lead.id))!;
    assert.equal(after.status, "converted");
    assert.ok(after.converted_at);
    assert.ok(leads.events.some((e) => e.action === "converted_to_client"));
  });
  test("a person who is already a client is not made twice", async () => {
    const { leads, lead, repo } = await seed();
    const first = await convertLeadToClient(repo, { repo: leads } as never, lead.id, { id: "u1" });
    const again = await convertLeadToClient(repo, { repo: leads } as never, lead.id, { id: "u1" });
    assert.equal(again.alreadyClient, true);
    assert.equal(again.client.id, first.client.id);
    assert.equal((await repo.listClients({ includeArchived: true })).length, 1);
  });
  test("a missing lead is refused", async () => {
    const { leads, repo } = await seed();
    await assert.rejects(() => convertLeadToClient(repo, { repo: leads } as never, "00000000-0000-4000-8000-000000000000", { id: "u1" }), ValidationError);
  });
});

import { changeTags, planBulk } from "../lib/contacts/bulk.ts";

describe("bulk actions on contacts", () => {
  const person = (key: string, refs: Partial<Contact["refs"]>) => ({ ...contact(refs), key, name: key });
  const list = [person("client-1", { clientId: "c1" }), person("lead-1", { leadId: "l1" }), person("lead-2", { leadId: "l2" }), person("customer-1", { customerIds: ["u1"] })];
  test("convert takes only leads that are not yet clients or converted", () => {
    const plan = planBulk(list, ["client-1", "lead-1", "lead-2", "customer-1"], "convert", (id) => (id === "l2" ? "converted" : "new"));
    assert.deepEqual(plan.targets.map((c) => c.key), ["lead-1"]);
    assert.deepEqual(plan.skipped.map((s) => s.reason).sort(), ["already a client", "already converted", "not a lead"]);
  });
  test("reassigning and tagging skip a store customer with no client or lead record", () => {
    for (const op of ["assign", "tag_add", "tag_remove"] as const) {
      const plan = planBulk(list, ["client-1", "lead-1", "customer-1"], op);
      assert.deepEqual(plan.targets.map((c) => c.key), ["client-1", "lead-1"]);
      assert.equal(plan.skipped.length, 1);
    }
  });
  test("the same contact twice counts once, and a key that does not exist is ignored", () => {
    assert.equal(planBulk(list, ["lead-1", "lead-1", "nobody"], "assign").targets.length, 1);
  });
  test("adding a tag twice does nothing new, and removing one that is not there changes nothing", () => {
    assert.deepEqual(changeTags(["a"], "tag_add", "b"), ["a", "b"]);
    assert.deepEqual(changeTags(["a", "b"], "tag_add", "b"), ["a", "b"]);
    assert.deepEqual(changeTags(["a", "b"], "tag_remove", "a"), ["b"]);
    assert.deepEqual(changeTags(["a"], "tag_remove", "z"), ["a"]);
  });
});

import { describeLeadEvent } from "../lib/leads/history.ts";
import { setLeadStatus } from "../lib/leads/service.ts";

describe("a lead's status and history", () => {
  const seed = async (status = "new") => {
    const repo = new MemoryLeads();
    const lead = await repo.insertLead({ tags: [], notes: null, phone: null, firm_name: null, status, source: "manual", last_contacted_at: null, audit_id: null, audit_score: null, wisp_plan_id: null, customer_id: null, order_id: null, organization_id: null, converted_at: null, full_name: "Ana Ruiz", email: "ana@example.com" } as never);
    return { repo, lead };
  };
  test("status can be set to New, Contacted, Interested or Lost, and the change is written to the history", async () => {
    const { repo, lead } = await seed();
    const after = await setLeadStatus({ repo } as never, lead.id, "lost", "actor");
    assert.equal(after.status, "lost");
    const ev = repo.events.find((e) => e.action === "status_changed")!;
    assert.equal(describeLeadEvent(ev), "Status changed from New to Lost");
    await setLeadStatus({ repo } as never, lead.id, "lost", "actor");
    assert.equal(repo.events.filter((e) => e.action === "status_changed").length, 1, "no change, no entry");
  });
  test("converted can't be picked by hand, and anything else is refused", async () => {
    const { repo, lead } = await seed();
    await assert.rejects(() => setLeadStatus({ repo } as never, lead.id, "converted", "a"), /Convert to client/);
    await assert.rejects(() => setLeadStatus({ repo } as never, lead.id, "bogus", "a"), ValidationError);
  });
  test("history lines read in plain words", () => {
    assert.equal(describeLeadEvent({ action: "contacted", detail: {} }), "Marked contacted");
    assert.equal(describeLeadEvent({ action: "assigned", detail: { to: "Luna" } }), "Assigned to Luna");
    assert.equal(describeLeadEvent({ action: "edited", detail: { fields: ["notes", "tags"] } }), "Edited notes, tags");
    assert.equal(describeLeadEvent({ action: "converted_to_client", detail: {} }), "Converted to a client");
    assert.equal(describeLeadEvent({ action: "something_new", detail: {} }), "Something new");
  });
  test("bulk status applies to leads that are not converted and skips the rest", () => {
    const mk = (key: string, refs: Partial<Contact["refs"]>) => ({ ...contact(refs), key, name: key });
    const plan = planBulk([mk("lead-1", { leadId: "l1" }), mk("lead-2", { leadId: "l2" }), mk("client-1", { clientId: "c1" })], ["lead-1", "lead-2", "client-1"], "set_status", (id) => (id === "l2" ? "converted" : "new"));
    assert.deepEqual(plan.targets.map((c) => c.key), ["lead-1"]);
    assert.equal(plan.skipped.length, 2);
  });
});

import { contactForKey } from "../lib/contacts/combine.ts";

describe("opening a contact by an older key", () => {
  test("a lead that became part of a client's contact is still found by its own key", () => {
    const L = "22222222-2222-4222-8222-222222222222", C = "11111111-1111-4111-8111-111111111111";
    const combined = { ...contact({ clientId: C, leadId: L }), key: `client-${C}` };
    assert.equal(contactForKey([combined], `client-${C}`)?.key, `client-${C}`);
    assert.equal(contactForKey([combined], `lead-${L}`)?.key, `client-${C}`);
    assert.equal(contactForKey([combined], "lead-33333333-3333-4333-8333-333333333333"), null);
    assert.equal(contactForKey([combined], "nonsense"), null);
  });
});

describe("comparing counts for leads too", () => {
  test("a lead shows whether it has notes and how many history entries, so two leads can be compared", async () => {
    const leads = new MemoryLeads();
    const lead = await leads.insertLead({ tags: [], notes: "Call Friday", phone: null, firm_name: null, status: "new", source: "manual", last_contacted_at: null, audit_id: null, audit_score: null, wisp_plan_id: null, customer_id: null, order_id: null, organization_id: null, converted_at: null, full_name: "Ana Ruiz", email: "ana@example.com" } as never);
    await leads.addEvent({ lead_id: lead.id, action: "contacted", detail: {}, actor_id: null });
    const got = await recordCounts(new MemoryWorkspace(), contact({ leadId: lead.id }), leads);
    assert.deepEqual(got, [{ label: "Notes", n: 1 }, { label: "History entries", n: 1 }]);
    assert.deepEqual(await recordCounts(new MemoryWorkspace(), contact({ leadId: lead.id })), [], "without the leads list there is nothing to count");
  });
});

import { archiveReturn, editReturn } from "../lib/workspace/service.ts";
import { describeEvent } from "../lib/workspace/activity.ts";

describe("editing a return", () => {
  const stages = ["s1", "s2", "s3"];
  const nameOf = (id: string) => ({ s1: "Intake", s2: "Prep", s3: "Filed" })[id] ?? id;
  const who = { assignee: (id: string | null) => (id ? "Luna" : "no one") };
  const seed = async () => {
    const repo = new MemoryWorkspace();
    const client = await repo.insertClient({ full_name: "Ana Ruiz", email: "a@example.com", phone: null, created_by: null } as never);
    const ret = await repo.insertReturn({ client_id: client.id, tax_year: 2025, kind: "original", parent_id: null, stage_id: "s1", due_on: "2026-04-15", notes: null } as never);
    return { repo, client, ret };
  };
  test("saves only what changed and writes it to the client's activity", async () => {
    const { repo, client, ret } = await seed();
    const out = await editReturn(repo, ret.id, { stage_id: "s2", due_on: "2026-05-01", filed_on: "", prep_status: "in_prep", assignee_id: "22222222-2222-4222-8222-222222222222", notes: "Needs W-2" }, stages, nameOf, who);
    assert.equal(out.changes.length, 5);
    const after = (await repo.getReturn(ret.id))!;
    assert.equal(after.stage_id, "s2");
    assert.equal(after.prep_status, "in_prep");
    assert.equal(after.notes, "Needs W-2");
    const ev = (await repo.listClientEvents(client.id, 5)).find((e) => e.action === "return.updated")!;
    assert.match(describeEvent(ev)!, /^2025 return: Stage from Intake to Prep; Due date from 2026-04-15 to 2026-05-01/);
    const same = await editReturn(repo, ret.id, { stage_id: "s2", due_on: "2026-05-01", prep_status: "in_prep", assignee_id: "22222222-2222-4222-8222-222222222222", notes: "Needs W-2" }, stages, nameOf, who);
    assert.deepEqual(same.changes, [], "nothing changed, nothing recorded");
  });
  test("moving to the last stage fills in today's date as filed, and a bad date or stage is refused", async () => {
    const { repo, ret } = await seed();
    const out = await editReturn(repo, ret.id, { stage_id: "s3", due_on: "2026-04-15" }, stages, nameOf, who, undefined, new Date("2026-04-10T12:00:00Z"));
    assert.equal(out.ret.filed_on, "2026-04-10");
    await assert.rejects(() => editReturn(repo, ret.id, { stage_id: "nope" }, stages, nameOf, who), /isn't in the pipeline/);
    await assert.rejects(() => editReturn(repo, ret.id, { stage_id: "s3", due_on: "13/45/2026" }, stages, nameOf, who), /valid date/);
  });
  test("a return handed to an ERO can't be set back by hand, and an archived return can't be edited", async () => {
    const { repo, ret } = await seed();
    await repo.updateReturn(ret.id, { prep_status: "handed_off" });
    await assert.rejects(() => editReturn(repo, ret.id, { stage_id: "s1", prep_status: "in_prep", due_on: "2026-04-15" }, stages, nameOf, who), /hand-off/);
    await archiveReturn(repo, ret.id);
    await assert.rejects(() => editReturn(repo, ret.id, { notes: "x" }, stages, nameOf, who), ValidationError);
    await assert.rejects(() => archiveReturn(repo, ret.id), ValidationError);
  });
});

import { removeStateFiling, saveStateFiling } from "../lib/workspace/service.ts";
import { formatResult } from "../lib/workspace/rules.ts";

describe("return details: form, filing status, e-file, result, fee and state returns", () => {
  const stages = ["s1", "s2"];
  const nameOf = (id: string) => id;
  const who = { assignee: () => "no one" };
  const seed = async () => {
    const repo = new MemoryWorkspace();
    const client = await repo.insertClient({ full_name: "Ana Ruiz", email: "a@example.com", phone: null, created_by: null } as never);
    const ret = await repo.insertReturn({ client_id: client.id, tax_year: 2025, kind: "original", parent_id: null, stage_id: "s1", due_on: "2026-04-15", notes: null } as never);
    return { repo, client, ret };
  };
  const base = { stage_id: "s1", due_on: "2026-04-15" };
  test("saves form, filing status, e-file (dated today when not given), result and fee, and records them", async () => {
    const { repo, client, ret } = await seed();
    const out = await editReturn(repo, ret.id, { ...base, form_type: "1040", filing_status: "married_joint", efile_status: "transmitted", federal_result: "$1,234.50", fee: "275" }, stages, nameOf, who, undefined, new Date("2026-02-01T12:00:00Z"));
    const after = out.ret;
    assert.equal(after.form_type, "1040");
    assert.equal(after.filing_status, "married_joint");
    assert.equal(after.efile_status, "transmitted");
    assert.equal(after.efile_on, "2026-02-01");
    assert.equal(after.federal_result_cents, 123450);
    assert.equal(after.fee_cents, 27500);
    const ev = (await repo.listClientEvents(client.id, 5)).find((e) => e.action === "return.updated")!;
    assert.match(describeEvent(ev)!, /Fee amount from blank to \$275\.00; Federal result from blank to \$1,234\.50/);
    const rejected = await editReturn(repo, ret.id, { ...base, efile_status: "rejected", efile_reject_reason: "R0000-504 SSN mismatch" }, stages, nameOf, who);
    assert.equal(rejected.ret.efile_status, "rejected");
    assert.equal(rejected.ret.efile_reject_reason, "R0000-504 SSN mismatch");
  });
  test("fields the form did not send are left alone, and bad values are refused", async () => {
    const { repo, ret } = await seed();
    await editReturn(repo, ret.id, { ...base, form_type: "1120-S", fee: "100" }, stages, nameOf, who);
    const kept = await editReturn(repo, ret.id, { ...base, notes: "hello" }, stages, nameOf, who);
    assert.equal(kept.ret.form_type, "1120-S");
    assert.equal(kept.ret.fee_cents, 10000);
    await assert.rejects(() => editReturn(repo, ret.id, { ...base, form_type: "9999" }, stages, nameOf, who), /isn't one of the choices/);
    await assert.rejects(() => editReturn(repo, ret.id, { ...base, fee: "abc" }, stages, nameOf, who), /valid amount/);
    await assert.rejects(() => editReturn(repo, ret.id, { ...base, federal_result: "abc" }, stages, nameOf, who), /valid amount/);
  });
  test("state returns are added, updated in place, and removed", async () => {
    const { repo, ret } = await seed();
    const a = await saveStateFiling(repo, ret.id, { state: "la", status: "in_prep" });
    assert.equal(a.state, "LA");
    await saveStateFiling(repo, ret.id, { state: "LA", status: "filed", filed_on: "2026-03-01" });
    const list = await repo.listStateFilings(ret.id);
    assert.equal(list.length, 1);
    assert.equal(list[0].status, "filed");
    await assert.rejects(() => saveStateFiling(repo, ret.id, { state: "Loo", status: "filed" }), /isn't a state abbreviation/);
    const owed = await saveStateFiling(repo, ret.id, { state: "TX", status: "filed", result: "-45.10" });
    assert.equal(owed.result_cents, -4510);
    await removeStateFiling(repo, ret.id, list[0].id);
    assert.equal((await repo.listStateFilings(ret.id)).length, 1);
  });
  test("an amount the client owes is negative, a refund is not, and both read back with a minus only for owed", async () => {
    const { repo, ret } = await seed();
    for (const [typed, cents] of [["1,234.50", 123450], ["-1,234.50", -123450], ["(200)", -20000], ["$-5.5", -550], ["0", 0]] as const) {
      const out = await editReturn(repo, ret.id, { ...base, federal_result: typed }, stages, nameOf, who);
      assert.equal(out.ret.federal_result_cents, cents, typed);
    }
    assert.equal(formatResult(-123450), "-$1,234.50");
    assert.equal(formatResult(123450), "$1,234.50");
    assert.equal(formatResult(null), "—");
  });
});

import { resolveState } from "../lib/workspace/states.ts";
import { addNote, addTask, deleteNote, deleteTask, editNote, editTask } from "../lib/workspace/service.ts";

describe("states", () => {
  test("an abbreviation or a full name is accepted, and anything else, like LO, is not", () => {
    assert.equal(resolveState("LA"), "LA");
    assert.equal(resolveState(" la "), "LA");
    assert.equal(resolveState("Louisiana"), "LA");
    assert.equal(resolveState("new york"), "NY");
    assert.equal(resolveState("LO"), null);
    assert.equal(resolveState("XX"), null);
    assert.equal(resolveState(""), null);
  });
  test("a state return with a made-up abbreviation is refused with a plain message", async () => {
    const repo = new MemoryWorkspace();
    const client = await repo.insertClient({ full_name: "Ana Ruiz", email: "a@example.com", phone: null, created_by: null } as never);
    const ret = await repo.insertReturn({ client_id: client.id, tax_year: 2025, kind: "original", parent_id: null, stage_id: "s1", due_on: null, notes: null } as never);
    await assert.rejects(() => saveStateFiling(repo, ret.id, { state: "LO", status: "filed" }), /"LO" isn't a state abbreviation/);
    assert.equal((await saveStateFiling(repo, ret.id, { state: "Louisiana", status: "filed" })).state, "LA");
  });
});

describe("saving a return's submission date", () => {
  test("it is the intake submission date, set on its own, and the filed date is no longer typed", async () => {
    const repo = new MemoryWorkspace();
    const client = await repo.insertClient({ full_name: "Ana Ruiz", email: "a@example.com", phone: null, created_by: null } as never);
    const ret = await repo.insertReturn({ client_id: client.id, tax_year: 2025, kind: "original", parent_id: null, stage_id: "s1", due_on: null, notes: null } as never);
    const out = await editReturn(repo, ret.id, { stage_id: "s1", submitted_on: "2026-01-20", filed_on: "2026-12-31" }, ["s1", "s2"], (x) => x, { assignee: () => "no one" });
    assert.equal(out.ret.submitted_on, "2026-01-20");
    assert.equal(out.ret.filed_on ?? null, null, "a typed filed date is ignored");
    await assert.rejects(() => editReturn(repo, ret.id, { stage_id: "s1", submitted_on: "soon" }, ["s1", "s2"], (x) => x, { assignee: () => "no one" }), /valid date/);
  });
});

describe("editing and deleting tasks and notes", () => {
  const seed = async () => {
    const repo = new MemoryWorkspace();
    const client = await repo.insertClient({ full_name: "Ana Ruiz", email: "a@example.com", phone: null, created_by: null } as never);
    return { repo, client };
  };
  test("a note can be edited and deleted, and each is recorded", async () => {
    const { repo, client } = await seed();
    const n = await addNote(repo, client.id, "Call after Friday", "u1");
    const after = await editNote(repo, n.id, "Call Monday instead", { id: "u1" });
    assert.equal(after.body, "Call Monday instead");
    await assert.rejects(() => editNote(repo, n.id, "   ", { id: "u1" }), /Write the note/);
    await deleteNote(repo, n.id, { id: "u1" });
    assert.equal((await repo.listNotes(client.id)).length, 0);
    const actions = (await repo.listClientEvents(client.id, 10)).map((e) => e.action);
    assert.ok(actions.includes("note.edited") && actions.includes("note.deleted"));
    await assert.rejects(() => deleteNote(repo, n.id), ValidationError);
  });
  test("a task can be edited and deleted", async () => {
    const { repo, client } = await seed();
    const t = await addTask(repo, client.id, { title: "Get W-2", due_on: "2026-02-01" }, "u1");
    const after = await editTask(repo, t.id, { title: "Get W-2 and 1099", due_on: "2026-02-05" }, { id: "u1" });
    assert.equal(after.title, "Get W-2 and 1099");
    assert.equal(after.due_on, "2026-02-05");
    await assert.rejects(() => editTask(repo, t.id, { title: "" }, { id: "u1" }), /Write the task/);
    await deleteTask(repo, t.id, { id: "u1" });
    assert.equal((await repo.listTasks({ clientId: client.id })).length, 0);
  });
  test("saving the same note or task twice in a moment (a double click) keeps one", async () => {
    const { repo, client } = await seed();
    const now = new Date("2026-10-15T12:00:00.000Z"); // the in-memory records are stamped with this moment
    const a = await addNote(repo, client.id, "Same note", "u1", now);
    const b = await addNote(repo, client.id, "Same note", "u1", new Date(now.getTime() + 2000));
    assert.equal(a.id, b.id);
    assert.equal((await repo.listNotes(client.id)).length, 1);
    await addTask(repo, client.id, { title: "Same task" }, "u1", now);
    await addTask(repo, client.id, { title: "Same task" }, "u1", new Date(now.getTime() + 2000));
    assert.equal((await repo.listTasks({ clientId: client.id })).length, 1);
    await addNote(repo, client.id, "Same note", "u1", new Date(now.getTime() + 60_000));
    assert.equal((await repo.listNotes(client.id)).length, 2, "a real repeat later is kept");
  });
});

import { shapeMoney } from "../lib/format/money-shape.ts";

describe("money boxes", () => {
  test("a leading minus is kept while typing, and the amount is formatted", () => {
    assert.equal(shapeMoney("-", true), "-");
    assert.equal(shapeMoney("-1", true), "-$1");
    assert.equal(shapeMoney("-1234.5", true), "-$1,234.5");
    assert.equal(shapeMoney("-$1,234.5", true, true), "-$1,234.50");
    assert.equal(shapeMoney("1234.5", true, true), "$1,234.50");
    assert.equal(shapeMoney("-50", false), "$50", "a fee can't be negative");
  });
  test("letters are left as typed so the server can refuse them instead of the box erasing them", () => {
    assert.equal(shapeMoney("abc", true), "abc");
    assert.equal(shapeMoney("12x", false), "12x");
  });
});

describe("saving what was typed", () => {
  const stages = ["s1", "s2"];
  const seed = async () => {
    const repo = new MemoryWorkspace();
    const client = await repo.insertClient({ full_name: "Ana Ruiz", email: "a@example.com", phone: null, created_by: null } as never);
    const ret = await repo.insertReturn({ client_id: client.id, tax_year: 2025, kind: "original", parent_id: null, stage_id: "s1", due_on: null, notes: null } as never);
    return { repo, ret };
  };
  test("text that is not an amount is refused and the saved figure stays", async () => {
    const { repo, ret } = await seed();
    await editReturn(repo, ret.id, { stage_id: "s1", federal_result: "-1,234.50", fee: "$100" }, stages, (x) => x, { assignee: () => "no one" });
    await assert.rejects(() => editReturn(repo, ret.id, { stage_id: "s1", federal_result: "abc" }, stages, (x) => x, { assignee: () => "no one" }), /valid amount/);
    await assert.rejects(() => editReturn(repo, ret.id, { stage_id: "s1", fee: "abc" }, stages, (x) => x, { assignee: () => "no one" }), /valid amount/);
    const kept = (await repo.getReturn(ret.id))!;
    assert.equal(kept.federal_result_cents, -123450);
    assert.equal(kept.fee_cents, 10000);
  });
  test("adding a state that is already there keeps its status, date and amount unless they are filled in", async () => {
    const { repo, ret } = await seed();
    await saveStateFiling(repo, ret.id, { state: "LA", status: "filed", filed_on: "2026-03-01", result: "-45.10" });
    const again = await saveStateFiling(repo, ret.id, { state: "Louisiana", status: "" });
    assert.equal(again.status, "filed");
    assert.equal(again.filed_on, "2026-03-01");
    assert.equal(again.result_cents, -4510);
    const changed = await saveStateFiling(repo, ret.id, { state: "LA", status: "accepted" });
    assert.equal(changed.status, "accepted");
    assert.equal(changed.filed_on, "2026-03-01");
    assert.equal((await saveStateFiling(repo, ret.id, { state: "TX", status: "" })).status, "not_started", "a new state starts as not started");
  });
  test("the e-file date uses the date the office gives (its own day), not the UTC day", async () => {
    const { repo, ret } = await seed();
    const evening = new Date("2026-10-29T01:30:00.000Z"); // still Oct 28 in Central time
    const out = await editReturn(repo, ret.id, { stage_id: "s1", efile_status: "transmitted" }, stages, (x) => x, { assignee: () => "no one" }, undefined, evening, "2026-10-28");
    assert.equal(out.ret.efile_on, "2026-10-28");
  });
});

import { filterContacts } from "../lib/contacts/combine.ts";

describe("filtering the Contacts list by teammate and lead stage", () => {
  const mk = (key: string, over: Partial<Contact>) => ({ ...contact({}), key, name: key, active: true, kinds: ["lead"] as Contact["kinds"], ...over }) as Contact;
  const list = [
    mk("a", { assignedTo: "u1", leadStatus: "new" }),
    mk("b", { assignedTo: "u2", leadStatus: "interested" }),
    mk("c", { assignedTo: null, leadStatus: "interested" }),
    mk("d", { kinds: ["client"], assignedTo: "u1", leadStatus: null }),
  ];
  test("assigned to one person, to no one, or anyone", () => {
    assert.deepEqual(filterContacts(list, { assigned: "u1" }).map((c) => c.key), ["a", "d"]);
    assert.deepEqual(filterContacts(list, { assigned: "none" }).map((c) => c.key), ["c"]);
    assert.equal(filterContacts(list, {}).length, 4);
  });
  test("lead stage narrows to leads at that stage, and filters combine", () => {
    assert.deepEqual(filterContacts(list, { stage: "interested" }).map((c) => c.key), ["b", "c"]);
    assert.deepEqual(filterContacts(list, { stage: "interested", assigned: "u2" }).map((c) => c.key), ["b"]);
    assert.deepEqual(filterContacts(list, { kind: "client", assigned: "u1" }).map((c) => c.key), ["d"]);
  });
});

import { randomUUID } from "node:crypto";
import { addMethod, cleanMethod, makePrimary, methodsFor, removeMethod, type ContactMethod, type MethodsDeps, type MethodsRepo } from "../lib/contacts/methods.ts";

describe("more than one email and phone per person", () => {
  const memoryMethods = (): MethodsRepo & { rows: ContactMethod[] } => {
    const rows: ContactMethod[] = [];
    return {
      rows,
      async list(o) { return rows.filter((r) => (o.kind === "client" ? r.client_id === o.id : r.lead_id === o.id)); },
      async get(id) { return rows.find((r) => r.id === id) ?? null; },
      async add(o, input) { const r: ContactMethod = { id: randomUUID(), client_id: o.kind === "client" ? o.id : null, lead_id: o.kind === "lead" ? o.id : null, created_at: "2026-10-29T00:00:00Z", ...input }; rows.push(r); return r; },
      async remove(id) { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); },
    };
  };
  const seed = async () => {
    const clients = new MemoryWorkspace();
    const leads = new MemoryLeads();
    const client = await clients.insertClient({ full_name: "Ana Ruiz", email: "ana@home.com", phone: "(337) 555-0100", created_by: null } as never);
    const lead = await leads.insertLead({ tags: [], notes: null, phone: "(337) 555-0111", firm_name: null, status: "new", source: "manual", last_contacted_at: null, audit_id: null, audit_score: null, wisp_plan_id: null, customer_id: null, order_id: null, organization_id: null, converted_at: null, full_name: "Bo Lee", email: "bo@example.com" } as never);
    const methods = memoryMethods();
    const deps: MethodsDeps = { methods, clients, leads };
    return { deps, methods, clients, leads, client, lead };
  };

  test("values are cleaned: email in lower case, phone in (555) 123-4567 form, and anything else is refused", () => {
    assert.deepEqual(cleanMethod("email", "work", " Ana@Work.COM "), { kind: "email", label: "work", value: "ana@work.com" });
    assert.deepEqual(cleanMethod("phone", "mobile", "337-555-0199"), { kind: "phone", label: "mobile", value: "(337) 555-0199" });
    assert.equal(cleanMethod("email", "nonsense", "a@b.co").label, "other");
    assert.throws(() => cleanMethod("email", "work", "not an email"), /valid email/);
    assert.throws(() => cleanMethod("phone", "work", "12345"), /10-digit/);
    assert.throws(() => cleanMethod("fax", "work", "x"), /email or phone/);
  });

  test("extras are added to a client, never repeat the main one or each other, and are capped", async () => {
    const { deps, client } = await seed();
    const owner = { kind: "client" as const, id: client.id };
    await addMethod(deps, owner, { kind: "email", label: "work", value: "ana@work.com" }, "u1");
    await assert.rejects(() => addMethod(deps, owner, { kind: "email", label: "work", value: "ANA@home.com" }, "u1"), /already .* main email/);
    await assert.rejects(() => addMethod(deps, owner, { kind: "email", label: "other", value: "ana@work.com" }, "u1"), /already on this person/);
    await assert.rejects(() => addMethod(deps, owner, { kind: "phone", label: "home", value: "(337) 555-0100" }, "u1"), /already .* main phone/);
    for (let i = 0; i < 9; i++) await addMethod(deps, owner, { kind: "email", label: "other", value: `x${i}@example.com` }, "u1");
    await assert.rejects(() => addMethod(deps, owner, { kind: "email", label: "other", value: "one-too-many@example.com" }, "u1"), /Up to 10/);
    const view = await methodsFor(deps, owner);
    assert.equal(view.primary.email, "ana@home.com");
    assert.equal(view.extras.length, 10);
  });

  test("making an extra the main one swaps it with the old main one, and nothing is lost", async () => {
    const { deps, methods, clients, client } = await seed();
    const owner = { kind: "client" as const, id: client.id };
    const work = await addMethod(deps, owner, { kind: "email", label: "work", value: "ana@work.com" }, "u1");
    await makePrimary(deps, owner, work.id, "u1");
    assert.equal((await clients.getClient(client.id))!.email, "ana@work.com");
    assert.deepEqual(methods.rows.map((r) => r.value), ["ana@home.com"], "the old main email is kept as an extra");
    const phone = await addMethod(deps, owner, { kind: "phone", label: "mobile", value: "337-555-0199" }, "u1");
    await makePrimary(deps, owner, phone.id, "u1");
    assert.equal((await clients.getClient(client.id))!.phone, "(337) 555-0199");
    assert.ok(methods.rows.some((r) => r.value === "(337) 555-0100"));
    const events = (await clients.listClientEvents(client.id, 10)).map((e) => e.action);
    assert.ok(events.includes("contact.method_added") && events.includes("contact.primary_changed"));
  });

  test("a lead works the same way, but cannot take another lead's email as its main one", async () => {
    const { deps, leads, lead } = await seed();
    const owner = { kind: "lead" as const, id: lead.id };
    await leads.insertLead({ tags: [], notes: null, phone: null, firm_name: null, status: "new", source: "manual", last_contacted_at: null, audit_id: null, audit_score: null, wisp_plan_id: null, customer_id: null, order_id: null, organization_id: null, converted_at: null, full_name: "Cy Dee", email: "cy@example.com" } as never);
    const ok = await addMethod(deps, owner, { kind: "email", label: "work", value: "bo@work.com" }, "u1");
    await makePrimary(deps, owner, ok.id, "u1");
    assert.equal((await leads.getLead(lead.id))!.email, "bo@work.com");
    const taken = await addMethod(deps, owner, { kind: "email", label: "other", value: "cy@example.com" }, "u1");
    await assert.rejects(() => makePrimary(deps, owner, taken.id, "u1"), /another lead/);
    assert.equal((await leads.getLead(lead.id))!.email, "bo@work.com", "nothing changed");
  });

  test("an extra can be removed, but only from its own person", async () => {
    const { deps, methods, client, lead } = await seed();
    const m = await addMethod(deps, { kind: "client", id: client.id }, { kind: "email", label: "work", value: "ana@work.com" }, "u1");
    await assert.rejects(() => removeMethod(deps, { kind: "lead", id: lead.id }, m.id, "u1"), ValidationError);
    await removeMethod(deps, { kind: "client", id: client.id }, m.id, "u1");
    assert.equal(methods.rows.length, 0);
  });
});
