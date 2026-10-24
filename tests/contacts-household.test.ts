import assert from "node:assert/strict";
import test from "node:test";
import { addDependent, addBusiness, linkSpouse, unlinkSpouse, addClient } from "../lib/workspace/service.ts";
import { addressLine, checkBusiness, checkClient, checkDependent, splitName } from "../lib/workspace/rules.ts";
import { MemoryWorkspace } from "./workspace-memory.ts";

test("names are kept in parts; a form that sends only a full name is split, and the last word is the last name", () => {
  assert.deepEqual(splitName("Ada Byron King"), { first: "Ada Byron", last: "King" });
  assert.deepEqual(splitName("Madonna"), { first: "Madonna", last: null });
  const parts = checkClient({ first_name: " Ada ", last_name: "King" });
  assert.equal(parts.full_name, "Ada King");
  assert.deepEqual([parts.first_name, parts.last_name], ["Ada", "King"]);
  assert.throws(() => checkClient({ first_name: "", last_name: "King" }), /first name/);
  const whole = checkClient({ full_name: "Ada Byron King" });
  assert.deepEqual([whole.first_name, whole.last_name], ["Ada Byron", "King"]);
});

test("date of birth and the address parts are read only when the form sent them, so an older form never wipes them", () => {
  const plain = checkClient({ full_name: "Ada King" });
  assert.equal("dob" in plain, false);
  assert.equal("city" in plain, false);
  const c = checkClient({ full_name: "Ada King", dob: "1985-03-09", address_line1: "12 main st", city: "dallas", state: "tx", zip: "750011234" });
  assert.equal(c.dob, "1985-03-09");
  assert.deepEqual([c.address_line1, c.city, c.state, c.zip], ["12 Main St", "Dallas", "TX", "75001-1234"]);
  assert.equal(c.address, "12 Main St, Dallas, TX 75001-1234");
  assert.throws(() => checkClient({ full_name: "A", dob: "03/09/1985" }), /date of birth/);
  assert.throws(() => checkClient({ full_name: "A", state: "Texas" }), /two-letter/);
  assert.throws(() => checkClient({ full_name: "A", zip: "123" }), /ZIP/);
  assert.equal(addressLine({ city: "Dallas", state: "TX" }), "Dallas, TX");
});

test("a dependent keeps only the last four of the number; a business gets a formatted EIN", () => {
  const d = checkDependent({ first_name: "Sam", last_name: "King", dob: "2015-06-01", relationship: "child", ssn: "123-45-6789" });
  assert.equal(d.ssn_last4, "6789");
  assert.equal(JSON.stringify(d).includes("12345"), false);
  assert.equal(checkDependent({ first_name: "Sam", ssn: "4321" }).ssn_last4, "4321");
  assert.throws(() => checkDependent({ first_name: "" }), /first name/);
  assert.throws(() => checkDependent({ first_name: "Sam", ssn: "123456" }), /nine digits/);
  assert.throws(() => checkDependent({ first_name: "Sam", relationship: "cousin-in-law" }), /related/);
  const b = checkBusiness({ name: "King Bakery", entity_type: "llc", ein: "123456789", phone: "5551234567" });
  assert.equal(b.ein, "12-3456789");
  assert.equal(b.phone, "(555) 123-4567");
  assert.throws(() => checkBusiness({ name: "X", ein: "12" }), /nine digits/);
});

test("two clients can be linked as spouses on both records, each has only one spouse, and unlinking clears both", async () => {
  const repo = new MemoryWorkspace();
  const ada = await addClient(repo, { full_name: "Ada King" }, "u");
  const bo = await addClient(repo, { full_name: "Bo King" }, "u");
  const cy = await addClient(repo, { full_name: "Cy Other" }, "u");
  await linkSpouse(repo, ada.id, bo.id);
  assert.equal((await repo.getClient(ada.id))!.spouse_id, bo.id);
  assert.equal((await repo.getClient(bo.id))!.spouse_id, ada.id);
  await assert.rejects(linkSpouse(repo, ada.id, cy.id), /already linked/);
  await assert.rejects(linkSpouse(repo, cy.id, bo.id), /already linked/);
  await assert.rejects(linkSpouse(repo, ada.id, ada.id), /own spouse/);
  await unlinkSpouse(repo, bo.id);
  assert.equal((await repo.getClient(ada.id))!.spouse_id, null);
  assert.equal((await repo.getClient(bo.id))!.spouse_id, null);
});

test("dependents and businesses are added to an existing client only", async () => {
  const repo = new MemoryWorkspace();
  const ada = await addClient(repo, { full_name: "Ada King" }, "u");
  await addDependent(repo, { client_id: ada.id, first_name: "Sam", relationship: "child" }, "u");
  await addBusiness(repo, { client_id: ada.id, name: "King Bakery" }, "u");
  assert.equal((await repo.listDependents(ada.id)).length, 1);
  assert.equal((await repo.listBusinesses(ada.id)).length, 1);
  await assert.rejects(addDependent(repo, { client_id: "00000000-0000-4000-8000-000000000000", first_name: "X" }, "u"), /wasn't found/);
  await assert.rejects(addBusiness(repo, { client_id: "nope", name: "X" }, "u"), /wasn't found/);
});
