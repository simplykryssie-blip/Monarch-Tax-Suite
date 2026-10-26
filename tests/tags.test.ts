import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryWorkspace } from "./workspace-memory.ts";
import { MemoryLeads } from "./leads-memory.ts";
import { deleteTag, renameTag, allTags, type TagDeps } from "../lib/tags/service.ts";
import { newTagName, tagCounts, workflowsUsingTag } from "../lib/tags/rules.ts";
import type { Workflow } from "../lib/automation/types.ts";

const input = (name: string, email: string, tags: string[]) => ({ full_name: name, email, phone: null, tags } as never);
async function setup() {
  const ws = new MemoryWorkspace();
  const leads = new MemoryLeads();
  const mk = async (name: string, email: string, tags: string[]) => ws.insertClient({ ...(input(name, email, []) as object), created_by: null, tags } as never);
  const a = await mk("Ann", "ann@x.test", ["refund", "vip"]);
  const b = await mk("Bob", "bob@x.test", ["refunds"]);
  await leads.insertLead({ full_name: "Lee", email: "lee@x.test", phone: null, firm_name: null, source: "booking", status: "new", notes: null, tags: ["refund", "booked"], last_contacted_at: null, audit_id: null, audit_score: null, wisp_plan_id: null, customer_id: null, order_id: null, organization_id: null, converted_at: null } as never);
  const deps: TagDeps = { clients: ws, leads };
  return { ws, leads, deps, a, b };
}

test("every tag is listed with how many clients and leads carry it", async () => {
  const s = await setup();
  assert.deepEqual(await allTags(s.deps), [
    { tag: "refund", clients: 1, leads: 1 }, { tag: "booked", clients: 0, leads: 1 }, { tag: "refunds", clients: 1, leads: 0 }, { tag: "vip", clients: 1, leads: 0 },
  ]);
  assert.deepEqual(tagCounts({ clients: [{ tags: ["Refund ", "refund"] }], leads: [{ tags: null }] }), [{ tag: "refund", clients: 1, leads: 0 }], "tidied and counted once per person");
});

test("renaming changes it for everyone, and a name that already exists merges the two", async () => {
  const s = await setup();
  assert.deepEqual(await renameTag(s.deps, "vip", " Top Client "), { people: 1, to: "top client", merged: false });
  assert.deepEqual((await s.ws.getClient(s.a.id))!.tags, ["refund", "top client"]);
  const merged = await renameTag(s.deps, "refunds", "refund");
  assert.deepEqual(merged, { people: 1, to: "refund", merged: true });
  assert.deepEqual((await s.ws.getClient(s.b.id))!.tags, ["refund"]);
  // Ann already had "refund": renaming a tag onto one she has leaves a single copy.
  await renameTag(s.deps, "top client", "refund");
  assert.deepEqual((await s.ws.getClient(s.a.id))!.tags, ["refund"]);
  await assert.rejects(renameTag(s.deps, "refund", "  "), /new name/);
  await assert.rejects(renameTag(s.deps, "refund", "Refund"), /already its name/);
  assert.deepEqual(newTagName("x".repeat(41)), { ok: false, message: "A tag can be up to 40 characters." });
  assert.deepEqual(newTagName("A, B"), { ok: true, tag: "a" }, "one tag at a time");
});

test("deleting takes the tag off everyone and leaves the people", async () => {
  const s = await setup();
  assert.deepEqual(await deleteTag(s.deps, "refund"), { people: 2 });
  assert.deepEqual((await s.ws.getClient(s.a.id))!.tags, ["vip"]);
  assert.deepEqual((await s.leads.listLeads({ limit: 10 }))[0].tags, ["booked"]);
  assert.equal((await s.ws.listClients({ includeArchived: true })).length, 2);
  assert.deepEqual(await deleteTag(s.deps, "nothing"), { people: 0 });
});

test("workflows that add, remove or start on a tag are found", () => {
  const wf = (name: string, over: Partial<Workflow>) => ({ id: name, name, trigger_event: "contact.tag_added", conditions: [], steps: [], actions: [], archived_at: null, ...over } as unknown as Workflow);
  const flows = [
    wf("Adds", { steps: [{ type: "add_tag", tag: "refund" }] as never }),
    wf("Starts", { conditions: [{ field: "tag", op: "eq", value: "refund" }] }),
    wf("Branches", { steps: [{ type: "branch", conditions: [{ field: "tag", op: "in", value: "x, refund" }], then: [], else: [{ type: "remove_tag", tag: "Refund" }] }] as never }),
    wf("Other", { steps: [{ type: "add_tag", tag: "vip" }] as never }),
    wf("Archived", { steps: [{ type: "add_tag", tag: "refund" }] as never, archived_at: "2026-01-01" }),
  ];
  assert.deepEqual(workflowsUsingTag("refund", flows).map((w) => w.name).sort(), ["Adds", "Branches", "Starts"]);
});
