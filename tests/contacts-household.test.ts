import assert from "node:assert/strict";
import test from "node:test";
import { addDependent, addBusiness, linkSpouse, unlinkSpouse, addClient, saveClientTags, addWork, moveWork } from "../lib/workspace/service.ts";
import { buildWorkBoard, addressLine, checkBusiness, checkClient, checkDependent, splitName } from "../lib/workspace/rules.ts";
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
  assert.throws(() => checkClient({ full_name: "A", state: "Texas" }), /isn't a state/);
  assert.throws(() => checkClient({ full_name: "A", state: "ZZ" }), /isn't a state/);
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

import { describeEvent, changedFields } from "../lib/workspace/activity.ts";
import { createInvoice, mergeClients, removeDependent, removeSpouse, saveClientWithChanges, saveSpouse, saveStandardFees, standardFees } from "../lib/workspace/service.ts";
import { checkClient as cc, defaultInvoiceLines, invoiceTotal } from "../lib/workspace/rules.ts";

test("the driver's license and last year's address are read, checked, and cleared together", () => {
  const c = cc({ full_name: "Ada King", dl_number: "tx12345678", dl_state: "tx", dl_issued_on: "2022-04-01", dl_expires_on: "2030-04-01" });
  assert.deepEqual([c.dl_number, c.dl_state, c.dl_issued_on, c.dl_expires_on], ["TX12345678", "TX", "2022-04-01", "2030-04-01"]);
  assert.throws(() => cc({ full_name: "A", dl_state: "Texas" }), /isn't a state/);
  assert.throws(() => cc({ full_name: "A", dl_issued_on: "2030-01-01", dl_expires_on: "2020-01-01" }), /expires before/);
  assert.equal("dl_number" in cc({ full_name: "A" }), false);
  const yes = cc({ full_name: "A", same_address: "yes", prior_address_line1: "old st" });
  assert.deepEqual([yes.address_same_as_last_year, yes.prior_address_line1], [true, null]);
  const no = cc({ full_name: "A", same_address: "no", prior_address_line1: "9 old rd", prior_city: "houston", prior_state: "tx", prior_zip: "77001" });
  assert.deepEqual([no.address_same_as_last_year, no.prior_address_line1, no.prior_city, no.prior_state], [false, "9 Old Rd", "Houston", "TX"]);
  assert.throws(() => cc({ full_name: "A", same_address: "no" }), /street/);
});

test("a spouse can be typed in by hand, replaced, and removed; a linked spouse blocks it", async () => {
  const repo = new MemoryWorkspace();
  const ada = await addClient(repo, { full_name: "Ada King" }, "u");
  const bo = await addClient(repo, { full_name: "Bo King" }, "u");
  await saveSpouse(repo, { client_id: ada.id, first_name: "Pat", last_name: "King", dob: "1984-02-02", phone: "5551234567", email: "PAT@Example.com", ssn: "123-45-6789" });
  const s = (await repo.getSpouse(ada.id))!;
  assert.deepEqual([s.first_name, s.phone, s.email, s.ssn_last4], ["Pat", "(555) 123-4567", "pat@example.com", "6789"]);
  await saveSpouse(repo, { client_id: ada.id, first_name: "Sam" });
  assert.equal((await repo.getSpouse(ada.id))!.first_name, "Sam");
  await removeSpouse(repo, ada.id);
  assert.equal(await repo.getSpouse(ada.id), null);
  await linkSpouse(repo, ada.id, bo.id);
  await assert.rejects(saveSpouse(repo, { client_id: ada.id, first_name: "Pat" }), /linked to a spouse/);
});

test("a business takes an email", () => {
  assert.equal(checkBusiness({ name: "Bakery", email: "Hello@Bakery.com" }).email, "hello@bakery.com");
  assert.throws(() => checkBusiness({ name: "Bakery", email: "nope" }), /email/);
});

test("changes to a client are recorded by name, with values only for plain contact details", async () => {
  const repo = new MemoryWorkspace();
  const ada = await addClient(repo, { full_name: "Ada King", phone: "5551234567" }, "u1", null, { id: "u1", email: "staff@example.com" });
  const { changes } = await saveClientWithChanges(repo, ada.id, { full_name: "Ada King", phone: "5559998888", dob: "1985-03-09", ssn_last4: "" }, { id: "u1", email: "staff@example.com" });
  assert.deepEqual(changes.map((c) => c.field), ["phone", "date of birth"]);
  assert.deepEqual(changes[0], { field: "phone", from: "(555) 123-4567", to: "(555) 999-8888" });
  assert.deepEqual(changes[1], { field: "date of birth" });
  const events = await repo.listClientEvents(ada.id, 10);
  assert.deepEqual(events.map((e) => e.action), ["client.updated", "client.created"]);
  assert.equal(JSON.stringify(events).includes("1985"), false, "the date of birth itself is never written to the record");
  assert.equal(describeEvent(events[0]), "Changed phone from (555) 123-4567 to (555) 999-8888, date of birth");
  assert.equal(events[0].detail.by, "staff@example.com");
  const same = await saveClientWithChanges(repo, ada.id, { full_name: "Ada King", phone: "5559998888", dob: "1985-03-09", ssn_last4: "" });
  assert.deepEqual(same.changes, []);
  assert.equal((await repo.listClientEvents(ada.id, 10)).length, 2, "saving with no change writes nothing");
  assert.deepEqual(changedFields(ada, ada), []);
});

test("the standard fees come from Settings, and the invoice only chooses whether to include them", async () => {
  const repo = new MemoryWorkspace();
  const ada = await addClient(repo, { full_name: "Ada King" }, "u");
  const base = { client_id: ada.id, tax_year: "2025" };
  const std = invoiceTotal(defaultInvoiceLines());
  assert.equal((await createInvoice(repo, { ...base, include_standard: "yes" }, "u")).total_cents, std);
  assert.equal((await createInvoice(repo, { ...base }, "u")).total_cents, std, "an older caller that sends nothing still gets the standard fees");
  assert.equal((await createInvoice(repo, { ...base, line_label_0: "Only this", line_amount_0: "10" }, "u")).total_cents, 1000, "an older caller that sends only its own lines gets just those");
  const withExtra = await createInvoice(repo, { ...base, include_standard: "yes", line_label_0: "Rush fee", line_amount_0: "50" }, "u");
  assert.equal(withExtra.total_cents, std + 5000);
  const only = await createInvoice(repo, { ...base, include_standard: "no", line_label_0: "Consult", line_amount_0: "75" }, "u");
  assert.deepEqual(only.lines, [{ label: "Consult", amount_cents: 7500 }]);
  await assert.rejects(createInvoice(repo, { ...base, include_standard: "no" }, "u"), /at least one line/);
  await saveStandardFees(repo, { line_label_0: "Prep", line_amount_0: "200", line_label_1: "E-file", line_amount_1: "25" }, "u");
  assert.deepEqual((await standardFees(repo)).map((l) => l.amount_cents), [20000, 2500]);
  assert.equal((await createInvoice(repo, { ...base, include_standard: "yes" }, "u")).total_cents, 22500);
  const tampered = await createInvoice(repo, { ...base, include_standard: "yes", standard_total: "1" }, "u");
  assert.equal(tampered.total_cents, 22500, "a value posted for the standard fees is ignored");
});

test("merging moves everything to the kept client, keeps what it already had, and archives the other", async () => {
  const repo = new MemoryWorkspace();
  const keep = await addClient(repo, { full_name: "Ada King", email: "ada@example.com" }, "u");
  const dup = await addClient(repo, { full_name: "A. King", email: "other@example.com", phone: "5551234567", dob: "1985-03-09" }, "u");
  await addDependent(repo, { client_id: dup.id, first_name: "Sam" }, "u");
  await repo.insertNote({ client_id: dup.id, body: "hi", created_by: "u" });
  const moved = await mergeClients(repo, keep.id, dup.id, { id: "u" });
  assert.equal(moved.dependents, 1);
  assert.equal((await repo.listDependents(keep.id)).length, 1);
  assert.equal((await repo.listNotes(keep.id)).length, 1);
  const k = (await repo.getClient(keep.id))!;
  assert.equal(k.email, "ada@example.com", "what the kept client had is not overwritten");
  assert.equal(k.phone, "(555) 123-4567", "what it was missing is filled in");
  assert.ok((await repo.getClient(dup.id))!.archived_at, "the merged client is archived, not deleted");
  assert.equal((await repo.listClientEvents(keep.id, 5))[0].action, "client.merged");
  await assert.rejects(mergeClients(repo, keep.id, keep.id), /two different/);
  await assert.rejects(removeDependent(repo, keep.id, "00000000-0000-4000-8000-000000000000"), /wasn't found/);
});

test("a spouse takes a driver's license and the 'filed together last year' answer is kept on the client", async () => {
  const repo = new MemoryWorkspace();
  const ada = await addClient(repo, { full_name: "Ada King" }, "u");
  const bo = await addClient(repo, { full_name: "Bo King" }, "u");
  await saveSpouse(repo, { client_id: ada.id, first_name: "Pat", dl_number: "tx999", dl_state: "tx", dl_issued_on: "2021-01-05", dl_expires_on: "2029-01-05", filed_last_year: "yes" });
  const s = (await repo.getSpouse(ada.id))!;
  assert.deepEqual([s.dl_number, s.dl_state, s.dl_issued_on, s.dl_expires_on], ["TX999", "TX", "2021-01-05", "2029-01-05"]);
  assert.equal((await repo.getClient(ada.id))!.filed_with_spouse_last_year, true);
  await saveSpouse(repo, { client_id: ada.id, first_name: "Pat" });
  assert.equal((await repo.getClient(ada.id))!.filed_with_spouse_last_year, true, "leaving the question unanswered does not clear an earlier answer");
  await assert.rejects(saveSpouse(repo, { client_id: ada.id, first_name: "Pat", dl_state: "Texas" }), /isn't a state/);
  await assert.rejects(saveSpouse(repo, { client_id: ada.id, first_name: "Pat", dl_issued_on: "2030-01-01", dl_expires_on: "2020-01-01" }), /expires before/);
  await removeSpouse(repo, ada.id);
  await linkSpouse(repo, ada.id, bo.id, undefined, false);
  assert.equal((await repo.getClient(ada.id))!.filed_with_spouse_last_year, false);
  assert.equal((await repo.getClient(bo.id))!.filed_with_spouse_last_year, false, "both clients carry the answer");
});

test("a contact's tags are saved tidy, changes are reported and recorded, and more than twelve is refused", async () => {
  const repo = new MemoryWorkspace();
  const c = await addClient(repo, { full_name: "Ada King" }, "u1");
  const first = await saveClientTags(repo, c.id, "VIP, new client, vip");
  assert.deepEqual(first.after, ["vip", "new client"]);
  assert.deepEqual((await repo.getClient(c.id))?.tags, ["vip", "new client"]);
  const second = await saveClientTags(repo, c.id, ["new client", "referral"]);
  assert.deepEqual(second.before, ["vip", "new client"]);
  assert.deepEqual(second.after, ["new client", "referral"]);
  const events = await repo.listClientEvents(c.id, 20);
  assert.equal(events.filter((e) => e.action === "client.tags_changed").length, 2);
  assert.match(describeEvent(events.find((e) => e.action === "client.tags_changed")!)!, /^Tags changed: /);
  const same = await saveClientTags(repo, c.id, "referral, new client");
  assert.deepEqual(same.before, same.after);
  await assert.rejects(saveClientTags(repo, c.id, Array.from({ length: 13 }, (_, i) => `t${i}`)), /up to 12/);
});

test("work in another pipeline starts in its first stage, moves only to its own stages, and shows on the board", async () => {
  const repo = new MemoryWorkspace();
  const c = await addClient(repo, { full_name: "Ada King" }, "u1");
  const pipeline = { id: "p1", stages: [{ id: "s1" }, { id: "s2" }, { id: "s3" }] };
  const w = await addWork(repo, { client_id: c.id, title: "October books", due_on: "2026-11-05" }, pipeline, "u1");
  assert.equal(w.stage_id, "s1");
  await assert.rejects(addWork(repo, { client_id: "nope" }, pipeline, "u1"), /client/i);
  await assert.rejects(addWork(repo, { client_id: c.id }, { id: "p1", stages: [] }, "u1"), /no stages/);
  await assert.rejects(moveWork(repo, w.id, "zzz", ["s1", "s2", "s3"]), /isn't in the pipeline/);
  await moveWork(repo, w.id, "s2", ["s1", "s2", "s3"]);
  const stages = [{ id: "s1", name: "New", color: "#000", done: false }, { id: "s2", name: "Working", color: "#000", done: false }, { id: "s3", name: "Done", color: "#000", done: true }];
  const cols = buildWorkBoard(stages, await repo.listWork({ pipelineId: "p1" }), new Map([[c.id, (await repo.getClient(c.id))!]]), "2026-11-10");
  assert.deepEqual(cols.map((x) => x.cards.length), [0, 1, 0]);
  assert.equal(cols[1].cards[0].label, "October books");
  assert.equal(cols[1].cards[0].late, true);
});
