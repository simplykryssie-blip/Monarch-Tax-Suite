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
