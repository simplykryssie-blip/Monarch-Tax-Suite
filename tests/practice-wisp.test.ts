import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import { CrmSecrets } from "../lib/crm/crypto.ts";
import type { DocumentStore } from "../lib/documents/types.ts";
import type { AuditInput } from "../lib/practice/service.ts";
import {
  addMonths, archiveIfLinked, attachCheckout, attest, confirmReview, downloadUrl, generate, markPaid, openAnswers, reminderOwed, reviewState, saveDraft,
  type PracticeWisp, type PracticeWispDeps, type PracticeWispRepo,
} from "../lib/practice/wisp.ts";

// The independent PTIN holder's WISP: draft -> paid -> generated -> attested -> yearly reviews, reminders at 30 and 7
// days, Overdue after (nothing locked), archived (not deleted) when the holder links to an ERO. Fake data only.

class MemoryWisps implements PracticeWispRepo {
  rows: PracticeWisp[] = [];
  async getLive() { return structuredClone(this.rows.find((r) => r.status !== "archived") ?? null); }
  async list() { return structuredClone(this.rows); }
  async findBySession(s: string) { return structuredClone(this.rows.find((r) => r.stripe_session_id === s) ?? null); }
  async insert(i: Pick<PracticeWisp, "id" | "practice_name" | "holder_name" | "answers_sealed">) {
    if (this.rows.some((r) => r.status !== "archived")) throw new Error("duplicate key practice_wisps_one_live");
    const w: PracticeWisp = { tenant_id: "t1", status: "draft", stripe_session_id: null, paid_at: null, pdf_path: null, pdf_sha256: null, generated_at: null, attested_at: null, attested_name: null, review_due_on: null, reminder_30_sent_at: null, reminder_7_sent_at: null, archived_at: null, archived_reason: null, created_at: "", updated_at: "", ...i };
    this.rows.push(w); return structuredClone(w);
  }
  async update(id: string, patch: Partial<PracticeWisp>) { const w = this.rows.find((r) => r.id === id)!; if (w.status === "archived") throw new Error("WISP_HISTORY_KEPT"); Object.assign(w, patch); return structuredClone(w); }
}
class MemoryStore implements DocumentStore {
  files = new Map<string, Uint8Array>();
  async createUploadUrl() { return { url: "" }; }
  async download(p: string) { return this.files.get(p) ?? null; }
  async upload(p: string, b: Uint8Array) { this.files.set(p, b); }
  async signedUrl(p: string, s: number, name: string | null) { return `signed:${p}:${s}:${name}`; }
  async remove(p: string[]) { for (const x of p) this.files.delete(x); }
  async discard(p: string[]) { for (const x of p) this.files.delete(x); }
}

const ANSWERS = {
  firm_name: "Pat's Tax", business_email: "pat@example.com", phone: "555-555-0100", owner_name: "Pat Example", ein: "1234", address: "1 Main St",
  tax_software: "FakeTax", data_locations: "Laptop, encrypted cloud", backup_method: "Encrypted cloud daily",
  num_users: "1", mfa_status: "MFA on all systems", access_policy: "Only me.",
  encryption: "Encrypted in transit and at rest", physical_security: "Locked cabinet", training: "Annual training completed",
  ir_contact: "Pat Example, owner", ir_steps: "1. Contain 2. Assess 3. Notify", review_date: "October 2027",
};
const T0 = new Date("2026-10-17T12:00:00Z");

function setup(opts: { linked?: boolean; at?: Date } = {}) {
  const repo = new MemoryWisps();
  const store = new MemoryStore();
  const audit: AuditInput[] = [];
  const state = { linked: !!opts.linked, at: opts.at ?? T0 };
  const deps: PracticeWispDeps = {
    tenantId: "t1", repo, store, secrets: CrmSecrets.fromBase64(randomBytes(32).toString("base64"))!,
    brandName: async () => "Verexa HQ", isLinked: async () => state.linked, audit: async (a) => { audit.push(a); }, now: () => state.at,
  };
  return { repo, store, audit, deps, state };
}
const paid = async (s: ReturnType<typeof setup>) => {
  const w = await saveDraft(s.deps, "u1", "Pat Example", ANSWERS);
  await attachCheckout(s.deps, w.id, "cs_test_1");
  await markPaid(s.deps, "cs_test_1");
  return w;
};

describe("dates and reminders", () => {
  test("a year on, with the 29th of February handled", () => {
    assert.equal(addMonths(new Date("2026-10-17T12:00:00Z"), 12).toISOString().slice(0, 10), "2027-10-17");
    assert.equal(addMonths(new Date("2028-02-29T00:00:00Z"), 12).toISOString().slice(0, 10), "2029-02-28");
    assert.equal(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString().slice(0, 10), "2026-02-28");
  });
  const w = (due: string | null, over: Partial<PracticeWisp> = {}) => ({ status: "active", review_due_on: due, reminder_30_sent_at: null, reminder_7_sent_at: null, ...over }) as PracticeWisp;
  test("not due, due soon, then overdue (which only describes it)", () => {
    assert.deepEqual(reviewState(w("2027-01-01"), T0), { state: "not_due", daysLeft: 76 });
    assert.deepEqual(reviewState(w("2026-11-10"), T0), { state: "due_soon", daysLeft: 24 });
    assert.deepEqual(reviewState(w("2026-10-17"), T0), { state: "due_soon", daysLeft: 0 });
    assert.deepEqual(reviewState(w("2026-10-10"), T0), { state: "overdue", daysLeft: -7 });
    assert.equal(reviewState(w(null), T0), null);
  });
  test("the 30-day reminder, then the 7-day one, each once; none when overdue or not active", () => {
    assert.equal(reminderOwed(w("2026-12-01"), T0), null);
    assert.equal(reminderOwed(w("2026-11-16"), T0), 30);
    assert.equal(reminderOwed(w("2026-11-16", { reminder_30_sent_at: "x" }), T0), null);
    assert.equal(reminderOwed(w("2026-10-24"), T0), 7);
    assert.equal(reminderOwed(w("2026-10-24", { reminder_7_sent_at: "x" }), T0), null);
    // Confirmed late: only the nearest reminder is owed, not both.
    assert.equal(reminderOwed(w("2026-10-20"), T0), 7);
    assert.equal(reminderOwed(w("2026-10-16"), T0), null);
    assert.equal(reminderOwed(w("2026-10-24", { status: "paid" }), T0), null);
    assert.equal(reminderOwed(w("2026-10-24", { status: "archived" }), T0), null);
  });
});

describe("building, buying, attesting", () => {
  test("answers are kept sealed and can be read back; a second save updates the same WISP", async () => {
    const s = setup();
    const w = await saveDraft(s.deps, "u1", "Pat Example", ANSWERS);
    assert.doesNotMatch(w.answers_sealed, /Pat's Tax|1 Main St/);
    assert.equal(openAnswers(s.deps, w).owner_name, "Pat Example");
    const again = await saveDraft(s.deps, "u1", "Pat Example", { ...ANSWERS, firm_name: "Pat's Tax LLC" });
    assert.equal(again.id, w.id);
    assert.equal(s.repo.rows.length, 1);
    assert.equal(again.practice_name, "Pat's Tax LLC");
  });
  test("missing or bad answers are refused", async () => {
    const s = setup();
    await assert.rejects(saveDraft(s.deps, "u1", "Pat", { ...ANSWERS, firm_name: "" }), /required/);
    await assert.rejects(saveDraft(s.deps, "u1", "Pat", { ...ANSWERS, mfa_status: "maybe" }), /Choose an option/);
    assert.equal(s.repo.rows.length, 0);
  });
  test("someone linked to an ERO doesn't build their own", async () => {
    const s = setup({ linked: true });
    await assert.rejects(saveDraft(s.deps, "u1", "Pat", ANSWERS), /office's WISP covers you/);
  });
  test("payment is recorded once, for the session this WISP started, and nothing is generated before it", async () => {
    const s = setup();
    const w = await saveDraft(s.deps, "u1", "Pat Example", ANSWERS);
    await assert.rejects(generate(s.deps, "u1"), /Buy the WISP first/);
    assert.equal(await markPaid(s.deps, "cs_unknown"), null);
    await attachCheckout(s.deps, w.id, "cs_test_1");
    assert.equal((await markPaid(s.deps, "cs_test_1"))!.status, "paid");
    await markPaid(s.deps, "cs_test_1");
    assert.equal(s.audit.filter((a) => a.action === "wisp_paid").length, 1);
  });
  test("generates the plan in sole-practitioner wording, filed under the holder's own folder", async () => {
    const s = setup();
    await paid(s);
    const w = await generate(s.deps, "u1");
    assert.match(w.pdf_path!, /^t1\/wisp\/practice-/);
    assert.ok(s.store.files.get(w.pdf_path!)!.length > 2000);
    assert.match(w.pdf_sha256!, /^[0-9a-f]{64}$/);
    assert.match(await downloadUrl(s.deps, w), /^signed:t1\/wisp\/practice-.*:60:WISP-Pat-s-Tax\.pdf$/);
    await assert.rejects(downloadUrl(s.deps, { ...w, pdf_path: "other-tenant/wisp/x.pdf" }), /not in this workspace's folder/);
  });
  test("changing the answers after generating makes the file out of date and it is made again", async () => {
    const s = setup();
    await paid(s);
    await generate(s.deps, "u1");
    const edited = await saveDraft(s.deps, "u1", "Pat Example", { ...ANSWERS, tax_software: "OtherTax" });
    assert.equal(edited.pdf_path, null);
    assert.equal(edited.status, "paid");
  });
  test("attesting needs the generated plan and the holder's own name; it sets the review a year out and is audited", async () => {
    const s = setup();
    await paid(s);
    await assert.rejects(attest(s.deps, "u1", "Pat Example"), /Generate your WISP/);
    await generate(s.deps, "u1");
    await assert.rejects(attest(s.deps, "u1", "Someone Else"), /Type your name exactly/);
    const w = await attest(s.deps, "u1", "  pat   EXAMPLE ");
    assert.equal(w.status, "active");
    assert.equal(w.review_due_on, "2027-10-17");
    assert.equal(w.attested_name, "pat   EXAMPLE");
    assert.ok(s.audit.some((a) => a.action === "wisp_attested"));
    await assert.rejects(saveDraft(s.deps, "u1", "Pat Example", ANSWERS), /already attested/);
    await assert.rejects(attest(s.deps, "u1", "Pat Example"), /already attested/);
  });
  test("the annual review moves the due date a year on and starts the reminders afresh", async () => {
    const s = setup();
    await paid(s);
    await generate(s.deps, "u1");
    await attest(s.deps, "u1", "Pat Example");
    s.repo.rows[0].reminder_30_sent_at = "2027-09-17T00:00:00Z";
    s.state.at = new Date("2027-11-01T12:00:00Z"); // overdue by two weeks; nothing was locked
    assert.equal(reviewState(s.repo.rows[0], s.state.at)!.state, "overdue");
    await assert.rejects(confirmReview(s.deps, "u1", "Nobody"), /Type your name exactly/);
    const w = await confirmReview(s.deps, "u1", "Pat Example");
    assert.equal(w.review_due_on, "2028-11-01");
    assert.equal(w.reminder_30_sent_at, null);
  });
});

describe("linking to an ERO", () => {
  test("archives the WISP as history, once linked; independent holders and empty accounts are untouched", async () => {
    const s = setup();
    await paid(s);
    await generate(s.deps, "u1");
    await attest(s.deps, "u1", "Pat Example");
    assert.equal(await archiveIfLinked(s.deps, "u1"), null);
    s.state.linked = true;
    const w = (await archiveIfLinked(s.deps, null))!;
    assert.equal(w.status, "archived");
    assert.equal(w.archived_reason, "linked_to_ero");
    assert.ok(w.archived_at);
    assert.equal(s.repo.rows.length, 1); // kept, not deleted
    assert.equal(w.review_due_on, "2027-10-17"); // the record itself is intact
    assert.equal(await archiveIfLinked(s.deps, null), null); // nothing live now
    assert.equal(reminderOwed(w, T0), null);
    assert.ok(s.audit.some((a) => a.action === "wisp_archived" && (a.detail as { reason: string }).reason === "linked_to_ero"));
    // Archived history can't be changed.
    await assert.rejects(s.repo.update(w.id, { holder_name: "x" }), /HISTORY_KEPT/);
  });
  test("a half-finished WISP is archived too", async () => {
    const s = setup();
    await saveDraft(s.deps, "u1", "Pat Example", ANSWERS);
    s.state.linked = true;
    assert.equal((await archiveIfLinked(s.deps, null))!.status, "archived");
  });
});
