import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mergePlan } from "../lib/contacts/merge-plan.ts";
import type { Contact } from "../lib/contacts/combine.ts";
import { mergeLeads } from "../lib/leads/service.ts";
import { ValidationError } from "../lib/commerce/validation.ts";
import { MemoryLeads } from "./leads-memory.ts";

const contact = (refs: Partial<Contact["refs"]>): Contact => ({ key: "x", name: "X", email: null, phone: null, kinds: [], chips: [], active: true, tags: [], refs: { leadId: null, clientId: null, customerIds: [], ...refs }, lastActivity: null, assignedTo: null });

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
