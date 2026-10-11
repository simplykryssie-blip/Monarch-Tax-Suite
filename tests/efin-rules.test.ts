import test from "node:test";
import assert from "node:assert/strict";
import { assignmentLapsed, availableTransitions, daysUntil, dueReminderStage, EfinRuleError, normalizeEin, findTransition, maskEfin, maskPtin, normalizeEfin, normalizePtin, planRenewalTasks, planTransition, renewalTracking, urgencyFor, type TransitionContext } from "../lib/efin/rules.ts";
import type { RenewalTaskRow } from "../lib/efin/types.ts";

const ctx = (over: Partial<TransitionContext> & { state?: TransitionContext["assignment"]["state"] } = {}): TransitionContext => ({
  assignment: { state: over.state ?? "draft", role: "ero", person_id: "p1", organization_id: "o1", requested_by: "u1", effective_from: null, effective_to: null },
  efin: { internal_status: "active", archived_at: null, organization_id: "o1" },
  actorId: "u2",
  to: over.to ?? "pending_review",
  reason: "",
  confirmed: false,
  roles: [{ organization_id: "o1", person_id: "p1", role: "ero", status: "active" }],
  credentials: [],
  ...over,
});

test("identifiers are validated and masked", () => {
  assert.equal(normalizeEfin("12-3456"), "123456");
  assert.throws(() => normalizeEfin("12345"), EfinRuleError);
  assert.equal(normalizePtin("p 0123 4567".replace(/ /g, "")), "P01234567");
  assert.throws(() => normalizePtin("01234567"), EfinRuleError);
  assert.equal(maskEfin("3456"), "••3456");
  assert.equal(maskPtin("4567"), "P••••4567");
  assert.ok(!maskEfin("3456").includes("12"));
});

test("a revoked assignment can never be reactivated", () => {
  assert.deepEqual(availableTransitions("revoked"), []);
  assert.throws(() => findTransition("revoked", "active"), /cannot be reactivated/);
  assert.throws(() => findTransition("expired", "active"), EfinRuleError);
});

test("assignments follow the workflow and skip no step", () => {
  assert.throws(() => findTransition("draft", "active"), EfinRuleError);
  assert.throws(() => findTransition("pending_review", "active"), EfinRuleError);
  assert.equal(planTransition(ctx({ state: "draft", to: "pending_review" })).action, "submit");
  assert.equal(planTransition(ctx({ state: "pending_review", to: "approved" })).action, "approve");
});

test("high-impact changes need confirmation and a reason", () => {
  assert.throws(() => planTransition(ctx({ state: "active", to: "suspended", reason: "Compliance hold pending review" })), /high-impact/);
  assert.throws(() => planTransition(ctx({ state: "active", to: "suspended", confirmed: true })), /reason is required/);
  const plan = planTransition(ctx({ state: "active", to: "suspended", confirmed: true, reason: "Compliance hold pending review" }));
  assert.equal(plan.highImpact, true);
  assert.throws(() => planTransition(ctx({ state: "active", to: "revoked", confirmed: true })), /reason is required/);
});

test("approving your own request needs a recorded reason", () => {
  assert.throws(() => planTransition(ctx({ state: "pending_review", to: "approved", actorId: "u1" })), /your own request/);
  assert.equal(planTransition(ctx({ state: "pending_review", to: "approved", actorId: "u1", reason: "Sole administrator" })).selfApproval, true);
});

test("a person must hold the role, and a preparer needs a recorded PTIN", () => {
  assert.throws(() => planTransition(ctx({ roles: [] })), /does not hold/);
  const prep = ctx({ roles: [{ organization_id: "o1", person_id: "p1", role: "tax_preparer", status: "active" }] });
  prep.assignment.role = "tax_preparer";
  assert.throws(() => planTransition(prep), /PTIN/);
  prep.credentials = [{ person_id: "p1", kind: "ptin", archived_at: null }];
  assert.equal(planTransition(prep).action, "submit");
  prep.credentials = [{ person_id: "p1", kind: "ptin", archived_at: "2026-01-01" }];
  assert.throws(() => planTransition(prep), /PTIN/);
});

test("an inactive or archived EFIN cannot receive assignments", () => {
  const c = ctx(); c.efin.internal_status = "suspended";
  assert.throws(() => planTransition(c), /suspended/);
  const d = ctx(); d.efin.archived_at = "2026-01-01";
  assert.throws(() => planTransition(d), /archived/);
});

test("date helpers and lapse detection", () => {
  assert.equal(daysUntil("2026-12-31", "2026-12-01"), 30);
  assert.equal(daysUntil("2026-12-01", "2026-12-02"), -1);
  assert.throws(() => daysUntil("12/31/2026", "2026-12-01"), EfinRuleError);
  assert.equal(assignmentLapsed({ state: "active", effective_to: "2026-01-01" }, "2026-01-02"), true);
  assert.equal(assignmentLapsed({ state: "suspended", effective_to: "2026-01-01" }, "2026-01-02"), false);
});

test("urgency escalates as the deadline nears and turns overdue after it", () => {
  assert.equal(urgencyFor(40), "open");
  assert.equal(urgencyFor(14), "urgent");
  assert.equal(urgencyFor(7), "escalated");
  assert.equal(urgencyFor(0), "escalated");
  assert.equal(urgencyFor(-1), "overdue");
});

test("reminders fire at 60/30/14/7 days, once a stage, never a burst after downtime", () => {
  const due = "2026-12-31";
  assert.equal(dueReminderStage(due, "2026-11-01"), 60);
  assert.equal(dueReminderStage(due, "2026-10-31"), null);
  assert.equal(dueReminderStage(due, "2026-12-01"), 30);
  assert.equal(dueReminderStage(due, "2026-12-17"), 14);
  assert.equal(dueReminderStage(due, "2026-12-24"), 7);
  // job was down for a week: only the latest reached stage
  assert.equal(dueReminderStage(due, "2026-12-20"), 14);
  assert.equal(dueReminderStage(due, "2027-01-02"), 0);
});

const efin = (over: Partial<Parameters<typeof planRenewalTasks>[0][number]> = {}) => ({ id: "e1", organization_id: "o1", efin_last4: "1234", recorded_expiration: "2026-12-31", expiration_verified: true, internal_status: "active" as const, archived_at: null, ...over });
const task = (over: Partial<RenewalTaskRow> = {}): RenewalTaskRow => ({ id: "t1", subject_type: "efin", subject_id: "e1", organization_id: "o1", title: "Renew", due_on: "2026-12-31", original_due_on: "2026-12-31", status: "open", completed_at: null, completion_note: null, evidence_note: null, ...over });

test("renewal tracking only trusts a recorded, verified date", () => {
  assert.deepEqual(renewalTracking(efin()), { track: true });
  assert.deepEqual(renewalTracking(efin({ recorded_expiration: null })), { track: false, reason: "missing_date" });
  assert.deepEqual(renewalTracking(efin({ expiration_verified: false })), { track: false, reason: "unverified_date" });
  assert.deepEqual(renewalTracking(efin({ internal_status: "suspended" })), { track: false, reason: "suspended" });
  assert.deepEqual(renewalTracking(efin({ archived_at: "2026-01-01" })), { track: false, reason: "archived" });
});

test("renewal task planning creates, updates on a changed date, and cancels when tracking stops", () => {
  assert.deepEqual(planRenewalTasks([efin()], [], "2026-10-01").map((p) => p.kind), ["create"]);
  assert.deepEqual(planRenewalTasks([efin()], [task()], "2026-10-01"), []);
  const moved = planRenewalTasks([efin({ recorded_expiration: "2027-01-31" })], [task()], "2026-10-01");
  assert.deepEqual(moved, [{ kind: "update", taskId: "t1", dueOn: "2027-01-31", status: "open" }]);
  assert.equal(planRenewalTasks([efin({ internal_status: "suspended" })], [task()], "2026-10-01")[0].kind, "cancel");
  assert.equal(planRenewalTasks([], [task()], "2026-10-01")[0].kind, "cancel");
  // a completed task is not touched and does not block a new cycle
  assert.deepEqual(planRenewalTasks([efin()], [task({ status: "done" })], "2026-10-01").map((p) => p.kind), ["create"]);
  // passing the deadline marks it overdue without inventing a new date
  assert.deepEqual(planRenewalTasks([efin()], [task()], "2027-01-05"), [{ kind: "update", taskId: "t1", dueOn: "2026-12-31", status: "overdue" }]);
});

import { complianceExceptions } from "../lib/efin/exceptions.ts";
import type { EfinRow } from "../lib/efin/types.ts";

const baseEfin = (over: Partial<EfinRow> = {}): EfinRow => ({ id: "e1", efin_last4: "1234", organization_id: "o1", location_id: null, ero_person_id: "p1", internal_status: "active", external_status: "manually_verified", external_verified_at: null, verification_source: null, recorded_expiration: "2027-06-30", expiration_verified: true, tax_year: 2026, notes: null, archived_at: null, archived_reason: null, created_at: "", updated_at: "", ...over });
const run = (efins: EfinRow[], extra: Partial<Parameters<typeof complianceExceptions>[0]> = {}) => complianceExceptions({ efins, assignments: [], filings: [], credentials: [], people: [], orgs: [], today: "2026-10-11", ...extra });

test("a healthy EFIN raises no exceptions", () => {
  assert.deepEqual(run([baseEfin()]), []);
});

test("exceptions describe recorded data only and never claim IRS status", () => {
  const kinds = (e: EfinRow) => run([e]).map((x) => x.kind);
  assert.deepEqual(kinds(baseEfin({ recorded_expiration: null, expiration_verified: false })), ["missing_expiration"]);
  assert.deepEqual(kinds(baseEfin({ expiration_verified: false })), ["unverified_expiration"]);
  assert.deepEqual(kinds(baseEfin({ recorded_expiration: "2026-09-01" })), ["past_deadline"]);
  assert.deepEqual(kinds(baseEfin({ ero_person_id: null })), ["no_ero"]);
  assert.deepEqual(kinds(baseEfin({ external_status: "unverified" })), ["efin_unverified"]);
  assert.deepEqual(kinds(baseEfin({ archived_at: "2026-01-01", ero_person_id: null })), []);
  for (const x of run([baseEfin({ recorded_expiration: "2026-09-01" })])) assert.ok(!/approved by the IRS|accepted/i.test(x.detail));
});

test("high-severity exceptions sort first", () => {
  const out = run([baseEfin({ id: "a", external_status: "unverified" }), baseEfin({ id: "b", ero_person_id: null })]);
  assert.equal(out[0].severity, "high");
});

import { bucketFor, statusBreakdown } from "../lib/efin/metrics.ts";

test("dashboard status buckets use recorded, verified data only", () => {
  const e = (over: Partial<EfinRow>) => baseEfin(over);
  assert.equal(bucketFor(e({}), "2026-10-11"), "active");
  assert.equal(bucketFor(e({ recorded_expiration: "2026-11-15" }), "2026-10-11"), "expiring");
  assert.equal(bucketFor(e({ recorded_expiration: "2026-11-15", expiration_verified: false }), "2026-10-11"), "active");
  assert.equal(bucketFor(e({ recorded_expiration: "2026-09-01" }), "2026-10-11"), "review");
  assert.equal(bucketFor(e({ internal_status: "renewal_review" }), "2026-10-11"), "review");
  assert.equal(bucketFor(e({ internal_status: "pending_verification" }), "2026-10-11"), "pending");
  assert.equal(bucketFor(e({ internal_status: "suspended", recorded_expiration: "2026-09-01" }), "2026-10-11"), "inactive");
  const b = statusBreakdown([e({}), e({ archived_at: "2026-01-01" }), e({ internal_status: "inactive" })], "2026-10-11");
  assert.deepEqual(b, { active: 1, expiring: 0, review: 0, pending: 0, inactive: 1 });
});

import { forField, tracksTeam } from "../lib/efin/rules.ts";

test("software/service clients get no team, PTIN or assignment tracking; own office and partners do", () => {
  assert.equal(tracksTeam("client"), false);
  for (const r of ["internal", "partner", "other"]) assert.equal(tracksTeam(r), true);
});

test("a rule error names its field so the form can keep everything else the user typed", () => {
  try {
    forField("ein", () => normalizeEin("12-345"));
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e instanceof EfinRuleError);
    assert.equal((e as EfinRuleError).field, "ein");
    assert.match((e as Error).message, /nine digits/);
  }
  // an error that already names a field keeps it
  try { forField("outer", () => { throw new EfinRuleError("x", "inner"); }); } catch (e) { assert.equal((e as EfinRuleError).field, "inner"); }
  assert.equal(forField("ein", () => normalizeEin("12-3456789")), "123456789");
});

test("clients are never flagged for a missing ERO assignment", () => {
  const org = (relationship: "client" | "partner") => ({ id: "o1", relationship, legal_name: "X" }) as never;
  const efin = baseEfin({ ero_person_id: null });
  assert.deepEqual(run([efin], { orgs: [org("client")] }).filter((x) => x.kind === "no_ero"), []);
  assert.equal(run([efin], { orgs: [org("partner")] }).filter((x) => x.kind === "no_ero").length, 1);
});

import { acronyms, sentence, words } from "../lib/efin/text.ts";
import { roleLabel } from "../lib/efin/rules.ts";

test("ERO, EFIN and PTIN are always capitalized in display text", () => {
  assert.equal(acronyms("add an ero and an efin; ptins and efins and eros"), "add an ERO and an EFIN; PTINs and EFINs and EROs");
  assert.equal(sentence("efin_created"), "EFIN created");
  assert.equal(words("ero"), "ERO");
  assert.equal(roleLabel("ero"), "ERO");
  assert.equal(roleLabel("responsible_official"), "Responsible official");
  assert.equal(acronyms("hero zero"), "hero zero"); // whole words only
  const found = run([baseEfin({ ero_person_id: null })], { assignments: [{ id: "a", efin_id: "e1", organization_id: "o1", person_id: null, role: "ero", state: "pending_review", requested_at: "2026-01-01T00:00:00Z" } as never] });
  assert.ok(found.some((x) => /^ERO assignment$/.test(x.title)));
});

import { nextSteps } from "../lib/efin/steps.ts";

test("next steps come from recorded data and skip assignments for software clients", () => {
  const org = (relationship: string) => ({ id: "o1", relationship }) as never;
  const person = { id: "p1", email: "a@b.co", phone: "555" } as never;
  const e = baseEfin({ external_status: "unverified", recorded_expiration: null, expiration_verified: false });
  const own = nextSteps({ org: org("internal"), efin: e, person, assignments: [], filings: [] });
  assert.deepEqual(own.filter((s) => !s.done).map((s) => s.key), ["verify", "renewal", "assignment", "filing"]);
  assert.ok(own.find((s) => s.key === "contact")?.done);
  const client = nextSteps({ org: org("client"), efin: e, person, assignments: [], filings: [] });
  assert.ok(!client.some((s) => s.key === "assignment"));
  assert.equal(nextSteps({ org: org("client"), assignments: [], filings: [] })[0].key, "efin");
  const done = nextSteps({ org: org("client"), efin: baseEfin(), person, assignments: [], filings: [{ id: "f", efin_id: "e1", archived_at: null } as never] });
  assert.ok(done.every((s) => s.done));
});

import { displayAddress, displayPhone, formatAddress, formatEin, formatName, formatPhone, formatState, formatStreet, formatZip, maskEfinInput, maskEinInput, maskPhoneInput, maskPtinInput } from "../lib/efin/format.ts";

test("phone numbers share one format and bad ones name their field", () => {
  assert.equal(formatPhone("337-858-7792"), "(337) 858-7792");
  assert.equal(formatPhone("1 (337) 858 7792"), "(337) 858-7792");
  assert.equal(formatPhone("3378587792"), "(337) 858-7792");
  assert.throws(() => formatPhone("858-7792"), (e: unknown) => e instanceof EfinRuleError && e.field === "person_phone");
  assert.equal(displayPhone("337.858.7792"), "(337) 858-7792");
  assert.equal(displayPhone("ext 5"), "ext 5");
  assert.equal(displayPhone(null), "");
});

test("typing masks build the format as you go", () => {
  assert.equal(maskPhoneInput("3378"), "(337) 8");
  assert.equal(maskPhoneInput("33785877921234"), "(337) 858-7792");
  assert.equal(maskEinInput("123456789"), "12-3456789");
  assert.equal(maskEinInput("1"), "1");
  assert.equal(maskEfinInput("12-34 56 78"), "123456");
  assert.equal(maskPtinInput("p0123456789"), "P01234567");
  assert.equal(maskPtinInput("01234567"), "P01234567");
  assert.equal(formatEin("123456789"), "12-3456789");
});

test("addresses are cleaned the same way every time", () => {
  assert.equal(formatStreet("3418 GREINWICH BOULEVARD"), "3418 Greinwich Blvd");
  assert.equal(formatStreet("  100   n main street  suite 4"), "100 N Main St Ste 4");
  assert.equal(formatStreet("PO BOX 12"), "PO Box 12");
  assert.equal(formatStreet("12 5th avenue"), "12 5th Ave");
  assert.deepEqual(formatAddress({ line1: "3418 greinwich blvd", city: "LAKE CHARLES", state: "la", zip: "706071234" }), { line1: "3418 Greinwich Blvd", city: "Lake Charles", state: "LA", zip: "70607-1234" });
  assert.throws(() => formatState("Louisiana"), (e: unknown) => e instanceof EfinRuleError && e.field === "state");
  assert.throws(() => formatZip("7060"), (e: unknown) => e instanceof EfinRuleError && e.field === "zip");
  assert.equal(formatZip(""), "");
  assert.equal(displayAddress({ line1: "3418 Greinwich Blvd", city: "Lake Charles", state: "LA", zip: "70607" }), "3418 Greinwich Blvd, Lake Charles, LA 70607");
  assert.equal(displayAddress({ city: "Dallas", state: "TX" }), "Dallas, TX");
  assert.equal(formatName("  Krystal   Esters "), "Krystal Esters");
});

import { structureLabel } from "../lib/efin/text.ts";
test("business types read correctly", () => {
  assert.equal(structureLabel("llc"), "LLC");
  assert.equal(structureLabel("s_corporation"), "S corporation");
  assert.equal(structureLabel(null), "");
});

import { checkUpload, safeFileName } from "../lib/efin/files.ts";

test("uploads are checked by size, extension, declared type and the file's own first bytes", () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  assert.deepEqual(checkUpload({ name: "W-9 form.PDF", size: 1000, type: "application/pdf" }, pdf), { name: "W-9_form.PDF", contentType: "application/pdf" });
  assert.throws(() => checkUpload({ name: "a.pdf", size: 5 * 1024 * 1024, type: "application/pdf" }, pdf), /4 MB/);
  assert.throws(() => checkUpload({ name: "a.exe", size: 10, type: "" }, pdf), /PDF, PNG, JPG or DOCX/);
  assert.throws(() => checkUpload({ name: "a.pdf", size: 10, type: "image/png" }, pdf), /does not match/);
  assert.throws(() => checkUpload({ name: "a.pdf", size: 10, type: "application/pdf" }, new Uint8Array([1, 2, 3, 4])), /real PDF/);
  assert.throws(() => checkUpload({ name: "a.pdf", size: 0, type: "application/pdf" }, pdf), /Choose a file/);
  assert.equal(safeFileName("../../etc/passwd"), "passwd");
  assert.equal(safeFileName("C:\\x\\my file (1).png"), "my_file_1_.png");
});

test("pending confirmation is not done in the next-steps checklist", () => {
  const org = { id: "o1", relationship: "client" } as never;
  const pend = nextSteps({ org, efin: baseEfin({ external_status: "pending" }), person: undefined, assignments: [], filings: [] });
  assert.equal(pend.find((s) => s.key === "verify")?.done, false);
  const ok = nextSteps({ org, efin: baseEfin({ external_status: "verified" }), person: undefined, assignments: [], filings: [] });
  assert.equal(ok.find((s) => s.key === "verify")?.done, true);
});
