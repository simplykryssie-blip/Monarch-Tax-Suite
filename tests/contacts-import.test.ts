import assert from "node:assert/strict";
import test from "node:test";
import { IMPORT_MAX_ROWS, phoneKey, planContactImport } from "../lib/imports/contacts.ts";
import { planMessagesImport, planNotesImport, readDate } from "../lib/imports/attach.ts";
import { runImport, unsupported, type ImportTarget } from "../lib/imports/service.ts";
import { clientsTarget, customersTarget, firmsTarget, leadsTarget, type FirmsPort } from "../lib/imports/targets.ts";

// A file shaped like GoHighLevel's contact export.
const GHL = [
  "Contact Id,First Name,Last Name,Business Name,Phone,Email,Created,Last Activity,Tags,Address1,City,State,Postal Code,Source",
  "a1,Maria,Lopez,,(337) 555-0101,Maria@Example.com,2025-01-02,2025-02-01,\"new client, referral\",12 Oak St,Lafayette,LA,70503,Facebook",
  "a2,Jon,Smith,Smith Tax LLC,+1 337 555 0102,jon@example.com,2025-01-03,2025-02-02,,,,,,Website",
  "a3,,,Acme Bakery,3375550103,,2025-01-04,,vip,,,,,",
  "a4,Ann,,,not-a-phone,not-an-email,2025-01-05,,,,,,,",
  "a5,Bob,Dup,,(337) 555-0101,bob@example.com,2025-01-06,,,,,,,",
  "a6,Maria,Again,,,maria@example.com,2025-01-07,,,,,,,",
  "a7,,,,3375550107,,2025-01-08,,,,,,,",
  "a8,Pat,Nocontact,,,,2025-01-09,,,,,,,",
].join("\n");

test("reads a GoHighLevel export: names, email, phone, tags, address", () => {
  const p = planContactImport(GHL, []);
  assert.equal(p.total, 8);
  const by = (n: string) => p.add.find((a) => a.full_name === n)!;
  const maria = by("Maria Lopez");
  assert.deepEqual([maria.email, maria.phone, maria.address], ["maria@example.com", "(337) 555-0101", "12 Oak St, Lafayette, LA, 70503"]);
  assert.deepEqual(maria.tags, ["new client", "referral"]);
  assert.equal(by("Jon Smith").email, "jon@example.com");
  assert.equal(by("Acme Bakery").phone, "3375550103", "a business with no person name is named by its company");
  assert.deepEqual(p.columns.used.includes("contact id"), false);
  assert.ok(p.columns.unknown.includes("contact id") && p.columns.unknown.includes("created"));
});

test("duplicates and unusable rows are left out, each with a reason", () => {
  const p = planContactImport(GHL, []);
  const reasons = Object.fromEntries(p.skipped.map((s) => [s.row, s.reason]));
  assert.match(reasons[6], /already there, or appears earlier/, "same phone as an earlier row");
  assert.match(reasons[7], /maria@example\.com/, "same email, different case");
  assert.match(reasons[8], /No name/);
  assert.match(reasons[9], /No usable email or phone/);
  // Bad email or phone is dropped with a note, but the person is still added if the other works.
  const ann = planContactImport("Name,Email,Phone\nAnn,not-an-email,3375550199", []).add[0];
  assert.deepEqual([ann.email, ann.phone], [null, "3375550199"]);
  assert.match(ann.notes.join(" "), /Email looked wrong/);
  assert.equal(p.add.length + p.skipped.length, p.total);
});

test("people already in the account are matched by email or by phone in any format", () => {
  const p = planContactImport(GHL, [{ email: "JON@example.com", phone: null }, { email: null, phone: "+1 (337) 555-0103" }]);
  const names = p.add.map((a) => a.full_name);
  assert.ok(!names.includes("Jon Smith") && !names.includes("Acme Bakery"));
  assert.ok(names.includes("Maria Lopez"));
  assert.equal(phoneKey("+1 337-555-0102"), "3375550102");
  assert.equal(phoneKey("555-0102"), "");
});

test("sensitive columns are never imported and are named to the person", () => {
  const p = planContactImport("Name,Email,SSN,Date of Birth,Bank Routing Number,Social Security Number\nAnn,ann@example.com,123-45-6789,1980-01-01,021000021,123-45-6789", []);
  assert.deepEqual(p.columns.sensitive, ["ssn", "date of birth", "bank routing number", "social security number"]);
  assert.equal(JSON.stringify(p.add).includes("123-45-6789"), false);
  assert.equal(JSON.stringify(p.add).includes("021000021"), false);
  assert.equal(p.add[0].full_name, "Ann");
});

test("tags: the person's own, then the import's; no repeats; limited", () => {
  const p = planContactImport("Name,Email,Tags\nAnn,ann@example.com,\"VIP, New Client ,vip\"", [], ["Imported from GoHighLevel"]);
  assert.deepEqual(p.add[0].tags, ["vip", "new client", "imported from gohighlevel"]);
  const many = planContactImport(`Name,Email,Tags\nAnn,ann@example.com,"${Array.from({ length: 15 }, (_, i) => `t${i}`).join(",")}"`, [], ["extra"]);
  assert.equal(many.add[0].tags.length, 12);
  assert.match(many.add[0].notes.join(" "), /Only 12 tags/);
});

test("the file must name its columns, and has limits", () => {
  assert.throws(() => planContactImport("", []), /no rows/);
  assert.throws(() => planContactImport("Email\nann@example.com", []), /name/);
  assert.throws(() => planContactImport("Name\nAnn", []), /Email or a Phone/);
  assert.throws(() => planContactImport(`Name,Email\n${Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `n${i},n${i}@x.com`).join("\n")}`, []), new RegExp(`up to ${IMPORT_MAX_ROWS}`));
  assert.throws(() => planContactImport("Name,Email\n,,\n,,", []), /no rows/);
});

test("a spreadsheet's formula guard apostrophe is undone, and control characters are cleaned", () => {
  const p = planContactImport("Name,Email,Phone\n\"'+Ann\u0007 Lee\",ann@example.com,", []);
  assert.equal(p.add[0].full_name, "+Ann Lee");
});

// ------------------------------------------------------------------ destinations

test("leads need an email and are told apart by it; firms are named by their business and told apart by name", () => {
  const leads = planContactImport(GHL, [], [], "leads");
  assert.deepEqual(leads.add.map((a) => a.full_name), ["Maria Lopez", "Jon Smith", "Bob Dup"], "phone-only rows are left out; a shared phone doesn't make a duplicate lead");
  assert.ok(leads.skipped.some((s) => /No usable email, which this needs/.test(s.reason)));
  assert.equal(leads.add[1].company, "Smith Tax LLC");
  const firms = planContactImport("Business Name,DBA,Email,Phone,Address1,City,State,Postal Code,Notes,Tags\nAcme Tax LLC,Acme,a@acme.com,3375550100,1 Main St,Lafayette,LA,70503,Good partner,vip\nacme tax llc,,,,,,,,,\n,,x@y.com,,,,,,,", [{ email: null, phone: null, name: "Old Firm" }], [], "firms");
  assert.equal(firms.add.length, 1);
  const f = firms.add[0];
  assert.deepEqual([f.full_name, f.dba, f.parts], ["Acme Tax LLC", "Acme", { line1: "1 Main St", city: "Lafayette", state: "LA", zip: "70503" }]);
  assert.match(f.note!, /Good partner/);
  assert.match(f.note!, /Contact: a@acme\.com · 3375550100/, "a firm has no email or phone of its own, so they go in the note");
  assert.deepEqual(f.tags, [], "firms keep no tags");
  assert.deepEqual(firms.columns.unsupported, ["tags"]);
  assert.equal(firms.skipped.length, 2);
  const customers = planContactImport("Name,Email,Tags,Notes\nAnn,ann@example.com,vip,hello", [], [], "customers");
  assert.deepEqual([customers.add[0].tags, customers.add[0].note], [[], null]);
  assert.deepEqual(customers.columns.unsupported, ["tags", "notes"]);
  assert.throws(() => planContactImport("Name,Phone\nAnn,3375550100", [], [], "leads"), /need an Email column/);
});

test("a Notes column comes along where the destination keeps notes", () => {
  const p = planContactImport("Name,Email,Notes\nAnn,ann@example.com,Prefers morning calls", []);
  assert.equal(p.add[0].note, "Prefers morning calls");
  assert.equal(planContactImport("Name,Email,Notes\nAnn,ann@example.com,hello", [], [], "leads").add[0].note, "hello");
});

test("what each destination supports", () => {
  assert.equal(unsupported("clients", "messages"), null);
  assert.match(unsupported("leads", "messages")!, /Messages can be imported into clients/);
  assert.match(unsupported("customers", "notes")!, /don't keep notes/);
  assert.equal(unsupported("firms", "notes"), null);
  assert.match(unsupported("firms", "messages")!, /message history/);
});

// ------------------------------------------------------------------ notes and messages

const PEOPLE = [
  { id: "c1", name: "Maria Lopez", email: "maria@example.com", phone: "(337) 555-0101" },
  { id: "c2", name: "Jon Smith", email: "jon@example.com", phone: null },
  { id: "c3", name: "Acme Bakery", email: null, phone: "3375550103" },
];

test("notes are attached to the person matched by email, phone or name; the rest are listed", () => {
  const csv = "Contact Email,Phone,Contact Name,Note,Date Created\nMaria@Example.com,,,Called about W-2,1/2/2025\n,337-555-0103,,Wants quote,2025-01-05\n,,Jon Smith,Met at expo,\nnobody@example.com,,,Lost,\nmaria@example.com,,,,\n";
  const p = planNotesImport(csv, PEOPLE);
  assert.deepEqual(p.add.map((n) => [n.personId, n.text]), [["c1", "Called about W-2"], ["c3", "Wants quote"], ["c2", "Met at expo"]]);
  assert.equal(p.add[0].at?.slice(0, 10), "2025-01-02");
  assert.equal(p.add[2].at, null);
  assert.deepEqual(p.skipped.map((s) => s.row), [5, 6]);
  assert.match(p.skipped[0].reason, /Import the people first/);
  assert.match(p.skipped[1].reason, /empty/);
  assert.throws(() => planNotesImport("Email\nmaria@example.com", PEOPLE), /Note, Body or Message/);
  assert.throws(() => planNotesImport("Note\nhello", PEOPLE), /Email, Phone or Name/);
});

test("messages carry direction, channel, subject and date, and are matched like notes", () => {
  const csv = "Email,Direction,Type,Subject,Message,Date\nmaria@example.com,inbound,TYPE_SMS,,Can you call me?,2025-01-02T15:04:00Z\nmaria@example.com,Outbound,Email,Your return,Sent your return,1/3/2025 3:30 PM\njon@example.com,,Call,,Left voicemail,\n";
  const p = planMessagesImport(csv, PEOPLE);
  assert.deepEqual(p.add.map((m) => [m.direction, m.channel, m.subject]), [["in", "sms", null], ["out", "email", "Your return"], ["out", "call", null]]);
  assert.equal(p.add[0].at, "2025-01-02T15:04:00.000Z");
  assert.ok(p.add[1].at && p.add[1].at.startsWith("2025-01-03"));
  assert.equal(readDate("not a date"), null);
  assert.equal(readDate("1/2/1850"), null);
});

// ------------------------------------------------------------------ the service, with fake destinations

type Saved = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
function fakeTarget(over: Partial<ImportTarget> & { existing?: { id: string; name: string | null; email: string | null; phone: string | null }[]; known?: string[]; failOn?: string } = {}) {
  const added: PlannedContactLike[] = [];
  const notes: [string, string, string | null][] = [];
  const messages: [string, string, string][] = [];
  const records: Saved[] = [];
  const target: ImportTarget = {
    destination: "clients",
    people: async () => over.existing ?? [],
    add: async (p) => { if (p.email && p.email === over.failOn) throw new Error("db"); added.push(p); return `new${added.length}`; },
    addNote: async (id, text, at) => { notes.push([id, text, at]); },
    addMessage: async (id, m) => { messages.push([id, m.body, m.direction]); },
    knownTags: async () => over.known ?? [],
    ...over,
  };
  return { target, added, notes, messages, records, record: async (d: Saved) => { records.push(d); } };
}
type PlannedContactLike = { full_name: string; tags: string[]; email: string | null };

test("service: a preview saves nothing; confirming saves the same people", async () => {
  const f = fakeTarget();
  const preview = await runImport(f.target, { kind: "contacts", csv: GHL, tag: "imported from ghl", confirm: false }, f.record);
  assert.deepEqual([preview.done, preview.willAdd, preview.total], [false, 3, 8]);
  assert.deepEqual([f.added.length, f.records.length], [0, 0]);
  const done = await runImport(f.target, { kind: "contacts", csv: GHL, tag: "imported from ghl", confirm: true }, f.record);
  assert.deepEqual([done.done, done.added, done.failed], [true, 3, 0]);
  assert.equal(f.added.length, 3);
});

test("service: imported tags are created, and the person is told which are new and which already existed", async () => {
  const f = fakeTarget({ known: ["referral", "vip"] });
  const r = await runImport(f.target, { kind: "contacts", csv: GHL, tag: "imported from ghl", confirm: false }, f.record);
  assert.deepEqual(r.newTags.sort(), ["imported from ghl", "new client"]);
  assert.deepEqual(r.existingTags.sort(), ["referral", "vip"]);
  const none = await runImport(fakeTarget({ destination: "firms" } as never).target, { kind: "contacts", csv: "Name,Email\nAnn,ann@example.com", tag: "", confirm: false }, f.record);
  assert.deepEqual(none.newTags, []);
});

test("service: the history records counts only, never names or contact details", async () => {
  const f = fakeTarget();
  await runImport(f.target, { kind: "contacts", csv: GHL, tag: "", confirm: true }, f.record);
  assert.equal(f.records.length, 1);
  assert.deepEqual(f.records[0], { kind: "contacts", destination: "clients", added: 3, skipped: 5, failed: 0, rows: 8, new_tags: 3 });
  assert.equal(JSON.stringify(f.records).includes("example.com"), false);
});

test("service: running it again adds nobody twice; one failed save doesn't stop the rest", async () => {
  const f = fakeTarget({ existing: [{ id: "x1", name: "M", email: "maria@example.com", phone: null }, { id: "x2", name: "J", email: "jon@example.com", phone: null }, { id: "x3", name: "A", email: null, phone: "3375550103" }] });
  assert.equal((await runImport(f.target, { kind: "contacts", csv: GHL, tag: "", confirm: true }, f.record)).added, 0);
  const g = fakeTarget({ failOn: "jon@example.com" });
  const r = await runImport(g.target, { kind: "contacts", csv: GHL, tag: "", confirm: true }, g.record);
  assert.deepEqual([r.added, r.failed], [2, 1]);
});

test("service: notes and messages attach to existing people; unmatched rows are listed; nothing is saved on a preview", async () => {
  const f = fakeTarget({ existing: PEOPLE });
  const csv = "Email,Note\nmaria@example.com,Hello\nnobody@x.com,Lost";
  const prev = await runImport(f.target, { kind: "notes", csv, tag: "", confirm: false }, f.record);
  assert.deepEqual([prev.willAdd, prev.skipped.length, f.notes.length], [1, 1, 0]);
  const done = await runImport(f.target, { kind: "notes", csv, tag: "", confirm: true }, f.record);
  assert.deepEqual([done.added, f.notes.length, f.notes[0][0]], [1, 1, "c1"]);
  const m = await runImport(f.target, { kind: "messages", csv: "Email,Direction,Message\njon@example.com,inbound,Hi", tag: "", confirm: true }, f.record);
  assert.deepEqual([m.added, f.messages[0]], [1, ["c2", "Hi", "in"]]);
  assert.deepEqual(f.records.map((r) => r.kind), ["notes", "messages"]);
});

test("service: a destination that can't keep notes or messages refuses clearly, and a file over 2 MB is refused", async () => {
  const f = fakeTarget({ destination: "customers" });
  await assert.rejects(() => runImport(f.target, { kind: "notes", csv: "Email,Note\na@b.co,x", tag: "", confirm: false }, f.record), /don't keep notes/);
  await assert.rejects(() => runImport(fakeTarget().target, { kind: "contacts", csv: "x".repeat(2_000_001), tag: "", confirm: false }, f.record), /too big/);
});

// ------------------------------------------------------------------ the real destinations, over fake ports

test("clients: owned by the person importing, in their office, with tags and a note; messages are history only", async () => {
  const inserted: Saved[] = [];
  const noteRows: Saved[] = [];
  const msgRows: Saved[] = [];
  const ws = {
    listClients: async () => [], insertClient: async (i: Saved) => { inserted.push(i); return { id: `c${inserted.length}`, ...i } as never; },
    insertNote: async (i: Saved) => { noteRows.push(i); return i as never; }, insertMessage: async (i: Saved) => { msgRows.push(i); return i as never; },
  };
  const t = clientsTarget(ws as never, { userId: "u1", organizationId: "org1", visible: async () => [{ id: "c9", full_name: "Zed", email: "zed@example.com", phone: null } as never] });
  const id = await t.add({ row: 2, full_name: "Ann", email: "ann@example.com", phone: null, address: null, tags: ["vip"], note: "Likes email", company: null, dba: null, parts: { line1: "", city: "", state: "", zip: "" }, notes: [] });
  assert.equal(id, "c1");
  assert.deepEqual([inserted[0].owner_id, inserted[0].created_by, inserted[0].organization_id, inserted[0].ssn_last4, inserted[0].tags], ["u1", "u1", "org1", null, ["vip"]]);
  assert.match(noteRows[0].body, /^Imported note: Likes email/);
  await t.addMessage!("c9", { row: 2, personId: "c9", person: "Zed", direction: "in", channel: "sms", subject: null, body: "hi", at: "2025-01-02T00:00:00.000Z" });
  assert.deepEqual([msgRows[0].direction, msgRows[0].channel, msgRows[0].occurred_at, "status" in msgRows[0]], ["in", "sms", "2025-01-02T00:00:00.000Z", false], "no status is set, so it is only logged");
  assert.deepEqual((await t.people("attach")).map((p) => p.id), ["c9"], "notes and messages can only go to people this person may see");
});

test("leads, customers and firms keep what they can", async () => {
  const leads: Saved[] = []; const events: Saved[] = [];
  const lt = leadsTarget({ listLeads: async () => [], insertLead: async (i: Saved) => { leads.push(i); return { id: "l1", ...i } as never; }, addEvent: async (e: Saved) => { events.push(e); }, tagCounts: async () => [{ tag: "vip", count: 2 }], getLead: async () => ({ notes: "old" }) as never, updateLead: async (_id: string, p: Saved) => { leads.push(p); return p as never; } } as never, { userId: "u1" });
  await lt.add({ row: 2, full_name: "Ann", email: "ann@example.com", phone: "3375550100", address: null, tags: ["vip"], note: "n", company: "Ann LLC", dba: null, parts: { line1: "", city: "", state: "", zip: "" }, notes: [] });
  assert.deepEqual([leads[0].status, leads[0].firm_name, leads[0].tags, leads[0].notes, events[0].action], ["new", "Ann LLC", ["vip"], "n", "imported"]);
  assert.match(String(leads[0].source), /Import/);
  await lt.addNote!("l1", "later", "2025-01-02T00:00:00.000Z");
  assert.match(leads[1].notes, /^old\n\nImported note \(2025-01-02\): later/);
  assert.deepEqual(await lt.knownTags!(), ["vip"]);

  const made: Saved[] = [];
  const ct = customersTarget({ listCustomers: async () => [], createCustomer: async (i: Saved) => { made.push(i); return { id: "k1" }; } });
  await ct.add({ row: 2, full_name: "Ann", email: "ann@example.com", phone: null, address: null, tags: [], note: null, company: null, dba: null, parts: { line1: "", city: "", state: "", zip: "" }, notes: [] });
  assert.deepEqual(made[0], { email: "ann@example.com", full_name: "Ann", stripe_customer_id: null });
  assert.equal(ct.addNote, undefined);

  const rec: string[] = []; const firms: Saved[] = []; const notesSet: Saved[] = [];
  const port: FirmsPort = { listFirms: async () => [{ id: "f1", legal_name: "Old", notes: "x" }], insertFirm: async (i) => { firms.push(i); return { id: "f2" }; }, setNotes: async (id, n) => { notesSet.push({ id, n }); }, recordCreated: async (id) => { rec.push(id); } };
  const ft = firmsTarget(port, { userId: "u1" });
  assert.equal(await ft.add({ row: 2, full_name: "Acme", email: null, phone: null, address: null, tags: [], note: "n", company: "Acme", dba: "A", parts: { line1: "1 Main", city: "Lafayette", state: "LA", zip: "70503" }, notes: [] }), "f2");
  assert.deepEqual([firms[0].legal_name, firms[0].dba_name, firms[0].primary_address.city, firms[0].created_by, rec], ["Acme", "A", "Lafayette", "u1", ["f2"]]);
  await ft.addNote!("f1", "more", null);
  assert.match(notesSet[0].n, /^x\n\nImported note: more/);
});

test("imported people are never marked as agreeing to marketing: the import does not touch consent", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["lib/imports/contacts.ts", "lib/imports/service.ts", "lib/imports/targets.ts", "lib/imports/attach.ts"]) assert.doesNotMatch(readFileSync(f, "utf8"), /marketing_consents|markMarketable|marketable|text_consent/i, f);
});

test("each import action re-checks who is signed in and which part of the app they have", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("app/import-actions.ts", "utf8");
  assert.match(src, /requirePrep\(scope, "clients\.intake"\)/);
  assert.match(src, /requireAdmin\(\)/);
  assert.match(src, /requireSection\(SECTION\[destination\]\)/);
  assert.match(src, /clients: "workspace", leads: "leads", customers: "store", firms: "bureau"/);
  assert.match(src, /scope === "admin" \? str\(form, "destination"\) : "clients"/, "the PTIN workspace and office area can only import clients");
});

test("imported notes, messages and tags can be seen on the client's page and in the list", async () => {
  const { readFileSync } = await import("node:fs");
  const views = readFileSync("components/prep/views.tsx", "utf8");
  assert.match(views, /ctx\.deps\.ws\.listNotes\(client\.id\)/);
  assert.match(views, /ctx\.deps\.ws\.listMessages\(client\.id\)/);
  assert.match(views, /<h2 style=\{\{ marginTop: 0 \}\}>Notes<\/h2>/);
  assert.match(views, /<h2 style=\{\{ marginTop: 0 \}\}>Messages<\/h2>/);
  assert.match(views, /client\.tags\?\.length/, "tags show on the client's page");
  assert.match(views, /<th>TAGS<\/th>/, "tags show in the client list");
});

test("the import screen is submitted by hand so finishing a preview doesn't reset the file type or the file", async () => {
  const { readFileSync } = await import("node:fs");
  const panel = readFileSync("components/imports/import-panel.tsx", "utf8");
  assert.match(panel, /onSubmit=\{\(e\) => \{ e\.preventDefault\(\)/);
  assert.match(panel, /new FormData\(e\.currentTarget, \(e\.nativeEvent as SubmitEvent\)\.submitter\)/, "the confirm button's value is still sent");
  assert.doesNotMatch(panel, /<form action=/, "an action form is reset when it finishes");
});
