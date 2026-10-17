import assert from "node:assert/strict";
import test from "node:test";
import { matchPerson, type PeopleDeps } from "../lib/people/match.ts";
import type { Lead, LeadsRepo } from "../lib/leads/types.ts";

function make(seed: { customers?: string[]; clients?: { id: string; phone: string | null }[]; lead?: Partial<Lead> } = {}) {
  const state = {
    lead: seed.lead ? ({ id: "L1", tags: [], phone: null, email: "a@b.co", ...seed.lead } as Lead) : null,
    events: [] as string[], filled: [] as string[], inserted: [] as Lead[],
  };
  const leads = {
    async findByEmail() { return state.lead; },
    async updateLead(_id: string, patch: Partial<Lead>) { state.lead = { ...state.lead!, ...patch }; return state.lead; },
    async insertLead(i: Omit<Lead, "id">) { const l = { ...i, id: "NEW" } as Lead; state.inserted.push(l); state.lead = l; return l; },
    async addEvent(e: { action: string }) { state.events.push(e.action); },
  } as unknown as LeadsRepo;
  const people = {
    async findCustomers() { return (seed.customers ?? []).map((id) => ({ id })); },
    async findClients() { return seed.clients ?? []; },
    async fillClientPhone(id: string) { state.filled.push(id); },
  };
  const deps: PeopleDeps = { people, leads };
  return { deps, state };
}

test("an unknown email becomes a lead with the source and tag", async () => {
  const { deps, state } = make();
  const r = await matchPerson(deps, { email: " Pat.Lee@Example.com ", source: "Booking: Intro call", tag: "booked" });
  assert.deepEqual(r.created, { kind: "lead", id: "NEW" });
  assert.equal(r.email, "pat.lee@example.com");
  assert.equal(state.inserted[0].full_name, "pat lee");
  assert.deepEqual(state.inserted[0].tags, ["booked"]);
  assert.deepEqual(state.events, ["created"]);
});

test("every record that matches is updated and no lead is created", async () => {
  const { deps, state } = make({ customers: ["C1"], clients: [{ id: "K1", phone: null }, { id: "K2", phone: "555" }], lead: { id: "L1" } });
  const r = await matchPerson(deps, { email: "a@b.co", phone: "(555) 010-0000", source: "Booking", tag: "booked", event: "booked" });
  assert.equal(r.created, null);
  assert.deepEqual(r.matches.map((m) => `${m.kind}:${m.id}`), ["customer:C1", "lead:L1", "client:K1", "client:K2"]);
  assert.deepEqual(state.filled, ["K1"]);
  assert.deepEqual(state.lead!.tags, ["booked"]);
  assert.ok(state.lead!.phone);
  assert.deepEqual(state.events, ["booked"]);
  assert.equal(state.inserted.length, 0);
});

test("a customer who is not a lead is matched, not duplicated as a lead", async () => {
  const { deps, state } = make({ customers: ["C1"] });
  const r = await matchPerson(deps, { email: "a@b.co", source: "Booking" });
  assert.equal(r.created, null);
  assert.equal(state.inserted.length, 0);
});

test("existing lead data is kept; the tag is not added twice", async () => {
  const { deps, state } = make({ lead: { phone: "111", tags: ["booked"] } });
  await matchPerson(deps, { email: "a@b.co", phone: "222", source: "x", tag: "booked" });
  assert.equal(state.lead!.phone, "111");
  assert.deepEqual(state.lead!.tags, ["booked"]);
});

test("a bad email is refused", async () => {
  await assert.rejects(matchPerson(make().deps, { email: "nope", source: "x" }));
});
