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
