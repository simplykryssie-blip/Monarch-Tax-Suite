import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { combineContacts, countContacts, filterContacts, normalizePhone, parseContactKey, possibleDuplicates, sortContacts, type ClientRec, type CustomerRec, type LeadRec } from "../lib/contacts/combine.ts";
import { sectionOf } from "../lib/tier.ts";

// Fake people only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const lead = (n: number, o: Partial<LeadRec> = {}): LeadRec => ({ id: id(n), full_name: `Lead ${n}`, email: `p${n}@example.com`, phone: null, status: "new", source: "form", tags: [], last_contacted_at: null, updated_at: "2026-01-01T00:00:00Z", ...o });
const client = (n: number, o: Partial<ClientRec> = {}): ClientRec => ({ id: id(100 + n), full_name: `Client ${n}`, email: `p${n}@example.com`, phone: null, archived_at: null, tags: [], updated_at: "2026-01-02T00:00:00Z", ...o });
const customer = (n: number, o: Partial<CustomerRec> = {}): CustomerRec => ({ id: id(200 + n), full_name: `Customer ${n}`, email: `p${n}@example.com`, status: "active", updated_at: "2026-01-03T00:00:00Z", ...o });

describe("combining leads, clients and customers", () => {
  test("the same email is one contact, anchored on the client", () => {
    const out = combineContacts({ leads: [lead(1)], clients: [client(1)], customers: [customer(1)] });
    assert.equal(out.length, 1);
    assert.equal(out[0].key, `client-${id(101)}`);
    assert.deepEqual(out[0].kinds, ["client", "lead", "customer"]);
  });
  test("email matching ignores case and spaces", () => {
    const out = combineContacts({ leads: [lead(1, { email: " P1@Example.com " })], clients: [client(1)], customers: [] });
    assert.equal(out.length, 1);
  });
  test("different emails stay separate", () => {
    assert.equal(combineContacts({ leads: [lead(1)], clients: [client(2)], customers: [customer(3)] }).length, 3);
  });
  test("records without an email stand alone", () => {
    const out = combineContacts({ leads: [], clients: [client(1, { email: null }), client(2, { email: null })], customers: [] });
    assert.equal(out.length, 2);
  });
  test("two clients on one email stay two contacts; the lead and customer are kept apart, not guessed", () => {
    const out = combineContacts({ leads: [lead(1)], clients: [client(1), client(1, { id: id(150), full_name: "Client 1b" })], customers: [customer(1)] });
    assert.equal(out.length, 3);
    assert.equal(out.filter((c) => c.kinds.includes("client")).every((c) => c.kinds.length === 1), true);
  });
  test("chips and active flag follow each record's state", () => {
    const [a] = combineContacts({ leads: [lead(1, { status: "lost" })], clients: [client(1, { archived_at: "2026-02-01T00:00:00Z" })], customers: [customer(1, { status: "inactive" })] });
    assert.deepEqual(a.chips.map((c) => c.label), ["Client", "Lead", "Customer"]);
    assert.equal(a.active, false);
    const [b] = combineContacts({ leads: [lead(2, { status: "converted" })], clients: [client(2)], customers: [] });
    assert.equal(b.active, true);
    assert.deepEqual(b.chips.map((c) => c.label), ["Client"], "a lead who became a client is just a Client");
    assert.deepEqual(b.kinds, ["client"]);
  });
  test("tags from the client and lead are merged once", () => {
    const [a] = combineContacts({ leads: [lead(1, { tags: ["vip", "a"] })], clients: [client(1, { tags: ["vip"] })], customers: [] });
    assert.deepEqual(a.tags, ["a", "vip"]);
  });
});

describe("possible duplicates", () => {
  test("same phone or same first+last name is reported, never combined", () => {
    const contacts = combineContacts({
      leads: [lead(1, { full_name: "Ann Example", phone: "(555) 123-4567" }), lead(2, { full_name: "Bob Other", phone: "1-555-123-4567" }), lead(3, { full_name: "Ann M Example" })],
      clients: [], customers: [],
    });
    assert.equal(contacts.length, 3);
    const reasons = possibleDuplicates(contacts).map((d) => d.reason).sort();
    assert.deepEqual(reasons, ["same_name", "same_phone"]);
  });
  test("a single-word name is never compared, and a pair is reported once", () => {
    const contacts = combineContacts({ leads: [lead(1, { full_name: "Madonna" }), lead(2, { full_name: "Madonna" })], clients: [], customers: [] });
    assert.equal(possibleDuplicates(contacts).length, 0);
    const shared = combineContacts({ leads: [lead(1)], clients: [client(1), client(1, { id: id(150) })], customers: [] });
    assert.equal(possibleDuplicates(shared).filter((d) => d.reason === "shared_email").length, 3);
  });
  test("phone normalising", () => {
    assert.equal(normalizePhone("+1 (555) 123-4567"), "5551234567");
    assert.equal(normalizePhone("123"), null);
  });
});

describe("list: filters, counts, order", () => {
  const contacts = combineContacts({
    leads: [lead(1), lead(2, { status: "lost" })],
    clients: [client(1), client(3, { archived_at: "2026-02-01T00:00:00Z" })],
    customers: [customer(4)],
  });
  test("default view is active only; Inactive shows the rest", () => {
    assert.equal(filterContacts(contacts, {}).length, 2);
    assert.equal(filterContacts(contacts, { kind: "inactive" }).length, 2);
  });
  test("kind filter and search", () => {
    assert.equal(filterContacts(contacts, { kind: "customer" }).length, 1);
    assert.equal(filterContacts(contacts, { q: "p4@example" }).length, 1);
    assert.equal(filterContacts(contacts, { q: "nobody" }).length, 0);
  });
  test("counts", () => {
    assert.deepEqual(countContacts(contacts), { all: 2, lead: 2, client: 2, customer: 1, inactive: 2 });
  });
  test("newest activity first", () => {
    const sorted = sortContacts(contacts);
    assert.equal(sorted[0].name, "Customer 4");
  });
});

describe("keys and wiring", () => {
  test("keys carry only a kind and an id", () => {
    assert.deepEqual(parseContactKey(`lead-${id(1)}`), { kind: "lead", id: id(1) });
    assert.equal(parseContactKey("lead-p1@example.com"), null);
    assert.equal(parseContactKey("../etc"), null);
    assert.equal(parseContactKey(undefined), null);
  });
  test("contacts open for the workspace tier and are gated by the admin guard", () => {
    assert.equal(sectionOf("/contacts"), "workspace");
    assert.equal(sectionOf(`/contacts/lead-${id(1)}`), "workspace");
    for (const f of ["app/(admin)/contacts/page.tsx", "app/(admin)/contacts/[key]/page.tsx"]) assert.match(readFileSync(f, "utf8"), /await requireAdmin\(\)/);
    assert.match(readFileSync("app/(admin)/contacts/layout.tsx", "utf8"), /requireSection\("workspace"\)/);
  });
  test("read-only, and sensitive client fields are not shown on the contact page", () => {
    const code = ["lib/contacts/server.ts", "lib/contacts/combine.ts", "app/(admin)/contacts/page.tsx", "app/(admin)/contacts/[key]/page.tsx"].map((f) => readFileSync(f, "utf8")).join("\n");
    assert.doesNotMatch(code, /\.(insert|update|upsert|delete)\(|"use server"/);
    assert.doesNotMatch(readFileSync("app/(admin)/contacts/[key]/page.tsx", "utf8"), /\bssn|ssn_last4|\baddress\b/i);
  });
});
