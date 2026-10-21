import assert from "node:assert/strict";
import test from "node:test";
import { IMPORT_MAX_ROWS, phoneKey, planContactImport } from "../lib/imports/contacts.ts";
import { importClients } from "../lib/imports/service.ts";
import type { PrepDeps, Scope } from "../lib/prep/types.ts";

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
  assert.match(reasons[6], /already in your clients, or appears earlier/, "same phone as an earlier row");
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

// ------------------------------------------------------------------ service

function setup(existing: { email: string | null; phone: string | null }[] = [], failOn?: string) {
  const inserted: Record<string, any>[] = [];  // eslint-disable-line @typescript-eslint/no-explicit-any
  const audits: Record<string, unknown>[] = [];
  const deps = {
    ws: {
      listClients: async () => existing,
      insertClient: async (input: Record<string, unknown>) => { if (input.email === failOn) throw new Error("db"); inserted.push(input); return input; },
    },
    audit: async (a: Record<string, unknown>) => { audits.push(a); },
  } as unknown as PrepDeps;
  const scope: Scope = { userId: "user-1", organizationId: "org-1", all: true } as Scope;
  return { deps, scope, inserted, audits };
}

test("service: a preview saves nothing; confirming saves the same people, owned by the person importing, with tags", async () => {
  const s = setup();
  const preview = await importClients(s.deps, s.scope, { csv: GHL, tag: "imported from ghl", confirm: false });
  assert.equal(preview.done, false);
  assert.equal(preview.plan.add.length, 3);
  assert.deepEqual(s.inserted, []);
  assert.deepEqual(s.audits, []);
  const done = await importClients(s.deps, s.scope, { csv: GHL, tag: "imported from ghl", confirm: true });
  assert.deepEqual([done.done, done.added, done.failed], [true, 3, 0]);
  assert.equal(s.inserted.length, 3);
  for (const row of s.inserted as Record<string, any>[]) {  // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual([row.owner_id, row.created_by, row.organization_id, row.ssn_last4], ["user-1", "user-1", "org-1", null]);
    assert.ok((row.tags as string[]).includes("imported from ghl"));
  }
});

test("service: the history records counts only, never names or contact details", async () => {
  const s = setup();
  await importClients(s.deps, s.scope, { csv: GHL, tag: "", confirm: true });
  assert.equal(s.audits.length, 1);
  assert.equal(s.audits[0].action, "clients_imported");
  assert.deepEqual(s.audits[0].detail, { added: 3, skipped: 5, failed: 0, rows: 8 });
  assert.equal(JSON.stringify(s.audits).includes("example.com"), false);
});

test("service: running it again adds nobody twice; one failed save doesn't stop the rest", async () => {
  const s = setup([{ email: "maria@example.com", phone: null }, { email: "jon@example.com", phone: null }, { email: null, phone: "3375550103" }]);
  const again = await importClients(s.deps, s.scope, { csv: GHL, tag: "", confirm: true });
  assert.equal(again.added, 0);
  const f = setup([], "jon@example.com");
  const r = await importClients(f.deps, f.scope, { csv: GHL, tag: "", confirm: true });
  assert.deepEqual([r.added, r.failed], [2, 1]);
});

test("service: a file over 2 MB is refused", async () => {
  const s = setup();
  await assert.rejects(() => importClients(s.deps, s.scope, { csv: "x".repeat(2_000_001), tag: "", confirm: false }), /too big/);
});

test("imported people are never marked as agreeing to marketing: the import does not touch consent", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["lib/imports/contacts.ts", "lib/imports/service.ts"]) assert.doesNotMatch(readFileSync(f, "utf8"), /marketing_consents|markMarketable|marketable|text_consent/i, f);
});
