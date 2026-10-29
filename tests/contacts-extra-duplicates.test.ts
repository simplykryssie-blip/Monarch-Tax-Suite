import test from "node:test";
import assert from "node:assert/strict";
import { combineContacts, possibleDuplicates } from "../lib/contacts/combine.ts";

const client = (id: string, name: string, email: string | null, phone: string | null) => ({ id, full_name: name, email, phone, archived_at: null, tags: [], updated_at: "2026-01-01T00:00:00Z", owner_id: null });

test("two people are flagged when an extra email of one is the main email of the other", () => {
  const contacts = combineContacts({ leads: [], customers: [], clients: [client("a", "Ana Lopez", "ana@home.test", null), client("b", "Robert Smith", "bob@work.test", null)] });
  assert.equal(possibleDuplicates(contacts).length, 0);
  const found = possibleDuplicates(contacts, { emails: (c) => (c.name === "Ana Lopez" ? ["Bob@Work.test"] : []) });
  assert.equal(found.length, 1);
  assert.equal(found[0].reason, "shared_email");
});

test("an extra phone matches another person's main phone", () => {
  const contacts = combineContacts({ leads: [], customers: [], clients: [client("a", "Ana Lopez", "ana@home.test", null), client("b", "Robert Smith", "bob@work.test", "(555) 123-4567")] });
  const found = possibleDuplicates(contacts, { phones: (c) => (c.name === "Ana Lopez" ? ["555-123-4567"] : []) });
  assert.equal(found.length, 1);
  assert.equal(found[0].reason, "same_phone");
});
