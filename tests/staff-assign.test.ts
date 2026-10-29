import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkAssignee, staffLabel, type StaffMember } from "../lib/staff/assign.ts";
import { combineContacts } from "../lib/contacts/combine.ts";
import { assignLead } from "../lib/leads/service.ts";
import { assignClient } from "../lib/workspace/service.ts";
import { MemoryWorkspace } from "./workspace-memory.ts";

const staff: StaffMember[] = [
  { id: "11111111-1111-4111-8111-111111111111", label: "Krystal", role: "owner" },
  { id: "22222222-2222-4222-8222-222222222222", label: "Luna", role: "staff" },
];

describe("assigning a contact to a teammate", () => {
  test("only someone on the team can be chosen, and an empty choice means no one", () => {
    assert.equal(checkAssignee(staff, ""), null);
    assert.deepEqual(checkAssignee(staff, staff[1].id), { id: staff[1].id, label: "Luna" });
    assert.throws(() => checkAssignee(staff, "33333333-3333-4333-8333-333333333333"), /isn't on your team/);
    assert.throws(() => checkAssignee(staff, "'; drop table clients;--"), /isn't on your team/);
    assert.equal(staffLabel(staff, staff[0].id), "Krystal");
    assert.equal(staffLabel(staff, null), null);
    assert.equal(staffLabel(staff, "33333333-3333-4333-8333-333333333333"), "A former teammate");
  });
  test("a client's owner changes, and the change is written to their activity", async () => {
    const repo = new MemoryWorkspace();
    const client = await repo.insertClient({ full_name: "Test Client", email: null, phone: null, ssn_last4: null, address: null, created_by: null, owner_id: staff[0].id });
    const moved = await assignClient(repo, client.id, { id: staff[1].id, label: "Luna" }, { id: staff[0].id });
    assert.equal(moved.owner_id, staff[1].id);
    const events = await repo.listClientEvents(client.id, 50);
    assert.ok(events.some((e) => e.action === "client.assigned" && (e.detail as { name?: string }).name === "Luna"));
    const cleared = await assignClient(repo, client.id, null);
    assert.equal(cleared.owner_id, null);
    const again = await assignClient(repo, client.id, null);
    assert.equal(again.owner_id, null);
    assert.equal((await repo.listClientEvents(client.id, 50)).filter((e) => e.action === "client.assigned").length, 2, "choosing the same person again records nothing");
  });
  test("a lead is assigned the same way and the change shows in the contact list", async () => {
    const leads: Record<string, unknown>[] = [{ id: "L1", assigned_to: null }];
    const events: { action: string; detail: Record<string, unknown> }[] = [];
    const repo = {
      getLead: async (id: string) => (leads.find((l) => l.id === id) as never) ?? null,
      updateLead: async (id: string, patch: Record<string, unknown>) => { const l = leads.find((x) => x.id === id)!; Object.assign(l, patch); return l as never; },
      addEvent: async (e: { action: string; detail: Record<string, unknown> }) => { events.push(e); },
    };
    await assignLead({ repo: repo as never }, "L1", { id: staff[1].id, label: "Luna" }, staff[0].id);
    assert.equal(leads[0].assigned_to, staff[1].id);
    assert.deepEqual(events.map((e) => e.action), ["assigned"]);
    const contacts = combineContacts({
      leads: [{ id: "L1", full_name: "Lee Lead", email: "lee@x.test", phone: null, status: "new", source: "manual", tags: [], last_contacted_at: null, updated_at: "2026-10-28T00:00:00Z", assigned_to: staff[1].id }],
      clients: [{ id: "C1", full_name: "Cam Client", email: "cam@x.test", phone: null, archived_at: null, updated_at: "2026-10-28T00:00:00Z", owner_id: staff[0].id }],
      customers: [],
    });
    assert.equal(contacts.find((c) => c.name === "Lee Lead")!.assignedTo, staff[1].id);
    assert.equal(contacts.find((c) => c.name === "Cam Client")!.assignedTo, staff[0].id);
  });
});
