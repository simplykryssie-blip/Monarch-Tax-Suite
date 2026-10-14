import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { CrmSecrets } from "../lib/crm/crypto.ts";
import {
  addMonths, earlyDeletion, ftcDuty, itemState, officeAlerts, ptinReminderPeriod, ptinSeason, retentionState, retentionUntil, reviewReminderStage, reviewState,
} from "../lib/compliance/rules.ts";
import {
  acknowledge, attest, buildWisp, closeIncident, create8879, delete8879, deleteDocument, finishUpload, lastAnswers, markStep, officeStatus, recordRenewal,
  runComplianceSweep, saveSettings, setItemDone, createItem, startIncident, startUpload, update8879, vaultDownload, type ComplianceDeps, type Ctx,
} from "../lib/compliance/service.ts";
import { can, defaultPermissions } from "../lib/office/permissions.ts";
import { MemoryDocumentStore } from "./documents-memory.ts";
import { MemoryCompliance } from "./compliance-memory.ts";

// Compliance Center: guided, not caged. IRS and FTC rules are worked out and warned about; the office can always go
// ahead with a reason that's kept. Every record stays in its own office.

const TENANT = "00000000-0000-4000-8000-0000000000a1";
const OFFICE = "00000000-0000-4000-8000-00000000f001";
const OTHER = "00000000-0000-4000-8000-00000000f002";
const ERO_M = "00000000-0000-4000-8000-0000000000e1";
const PREP_M = "00000000-0000-4000-8000-0000000000e2";

const WISP = {
  firm_name: "Bayou Tax LLC", owner_name: "Erin Ero", address: "1 Main St, Lake Charles, LA", phone: "(337) 555-0100", tax_software: "TaxSlayer Pro",
  data_locations: "TaxSlayer cloud", backup_method: "Encrypted cloud backup daily", num_users: "3", mfa_status: "MFA on all systems",
  access_policy: "By role.", encryption: "Encrypted in transit and at rest", physical_security: "Locked cabinets.", training: "Annual training completed",
  ir_contact: "Erin Ero, owner", ir_steps: "1. Contain 2. Notify", review_date: "January 2027",
};

async function pdf() {
  const d = await PDFDocument.create();
  d.addPage();
  return d.save();
}

function setup(day = "2026-10-20T15:00:00Z") {
  const repo = new MemoryCompliance();
  const store = new MemoryDocumentStore();
  let clock = new Date(day);
  repo.clock = () => clock;
  repo.offices = [{ id: OFFICE, name: "Bayou Tax", archived: false }, { id: OTHER, name: "Other Tax", archived: false }];
  repo.team = [
    { id: ERO_M, organization_id: OFFICE, role: "ero", email: "ero@example.com", full_name: "Erin Ero", status: "active" },
    { id: PREP_M, organization_id: OFFICE, role: "preparer", email: "prep@example.com", full_name: "Pat Prep", status: "active" },
  ];
  const sent: { to: string; subject: string; text: string }[] = [];
  let mailResult: string | null = null;
  const deps: ComplianceDeps = {
    tenantId: TENANT, repo, store, secrets: new CrmSecrets(randomBytes(32)), origin: async () => "https://app.test",
    send: async (m) => { sent.push(m); return mailResult; }, now: () => clock,
  };
  const ero: Ctx = { userId: "u-ero", name: "Erin Ero", role: "ero", memberId: ERO_M, permissions: {}, officeId: OFFICE, officeName: "Bayou Tax" };
  const prep: Ctx = { userId: "u-prep", name: "Pat Prep", role: "preparer", memberId: PREP_M, permissions: defaultPermissions(), officeId: OFFICE, officeName: "Bayou Tax" };
  const bureau: Ctx = { userId: "u-admin", name: "Admin", role: "bureau", memberId: null, permissions: {}, officeId: OFFICE, officeName: "Bayou Tax" };
  return { repo, store, deps, sent, ero, prep, bureau, set: (iso: string) => { clock = new Date(iso); }, failMail: (m: string | null) => { mailResult = m; } };
}

async function upload(s: ReturnType<typeof setup>, ctx: Ctx, kind = "8879", title = "8879 Smith 2025") {
  const t = await startUpload(s.deps, ctx, { kind, title, fileName: "8879.pdf", sizeBytes: 1000 });
  s.store.put(t.doc.file_path, await pdf());
  return finishUpload(s.deps, ctx, t.doc.id);
}

describe("rules", () => {
  test("8879 retention: 3 years from the later of the due date and the IRS received date (Pub. 1345)", () => {
    assert.equal(retentionUntil("2026-04-15", null), "2029-04-15");
    assert.equal(retentionUntil("2026-04-15", "2026-05-01"), "2029-05-01", "received late");
    assert.equal(retentionUntil("2026-10-15", "2026-04-10"), "2029-10-15", "extension: the due date is later");
    assert.equal(retentionUntil("2028-02-29", null), "2031-02-28", "matches the database on a leap day");
    assert.equal(retentionState("2029-04-15", "2028-12-01", 90), "keep");
    assert.equal(retentionState("2029-04-15", "2029-01-20", 90), "ending");
    assert.equal(retentionState("2029-04-15", "2029-04-15", 90), "past");
    assert.equal(earlyDeletion("2029-04-15", "2027-01-01").early, true);
    assert.equal(earlyDeletion("2029-04-15", "2027-01-01").warning, "Required by IRS: this record must be kept for 3 years from April 15, 2026. Deleting it early is your decision.");
    assert.equal(earlyDeletion("2029-04-15", "2029-04-16").early, false);
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  });

  test("WISP review: due soon from the longest reminder, a stage per reminder day, then overdue", () => {
    assert.equal(reviewState(null, "2026-10-20", [30, 7]).state, "none");
    const r = (today: string) => reviewState({ review_due: "2026-12-01" }, today, [30, 7]);
    assert.equal(r("2026-10-20").state, "current");
    assert.equal(r("2026-11-01").state, "due_soon");
    assert.equal(reviewReminderStage(r("2026-10-20"), [30, 7]), null);
    assert.equal(reviewReminderStage(r("2026-11-01"), [30, 7]), "d30");
    assert.equal(reviewReminderStage(r("2026-11-25"), [30, 7]), "d7");
    assert.equal(r("2026-12-02").state, "overdue");
    assert.equal(reviewReminderStage(r("2026-12-02"), [30, 7]), "overdue");
  });

  test("PTIN: every PTIN expires Dec 31; the season is Oct 16 – Dec 31 and renews for next year", () => {
    assert.deepEqual([ptinSeason("2026-10-15").inSeason, ptinSeason("2026-10-15").renewalYear], [false, 2026]);
    assert.deepEqual([ptinSeason("2026-10-16").inSeason, ptinSeason("2026-10-16").renewalYear], [true, 2027]);
    assert.equal(ptinSeason("2026-12-31").renewalYear, 2027);
    assert.equal(ptinReminderPeriod("2026-09-01", 14), null);
    assert.equal(ptinReminderPeriod("2026-10-16", 14), "2027:0");
    assert.equal(ptinReminderPeriod("2026-10-29", 14), "2027:0");
    assert.equal(ptinReminderPeriod("2026-10-30", 14), "2027:1");
  });

  test("FTC: 500 or more people with unencrypted (or unknown) information, 30 days from discovery", () => {
    const base = { discovered_on: "2026-10-01", ftc_notified_on: null };
    assert.equal(ftcDuty({ ...base, people_affected: 499, info_encrypted: "no" }, "2026-10-05").applies, false);
    assert.equal(ftcDuty({ ...base, people_affected: 500, info_encrypted: "yes" }, "2026-10-05").applies, false);
    const d = ftcDuty({ ...base, people_affected: 500, info_encrypted: "unknown" }, "2026-11-01");
    assert.deepEqual([d.applies, d.deadline, d.overdue], [true, "2026-10-31", true]);
  });

  test("office items: a yearly item is done for its current cycle only", () => {
    assert.equal(itemState({ repeat: "once", due_on: "2026-11-01", done_at: null }, "2026-11-05").state, "overdue");
    assert.equal(itemState({ repeat: "once", due_on: null, done_at: "2026-01-01T12:00:00Z" }, "2026-11-05").state, "done");
    assert.equal(itemState({ repeat: "yearly", due_on: "2027-11-01", done_at: "2026-11-02T12:00:00Z" }, "2026-11-05").state, "done");
    assert.equal(itemState({ repeat: "yearly", due_on: "2026-11-20", done_at: "2025-11-02T12:00:00Z" }, "2026-11-05").state, "due_soon");
  });
});

describe("permissions and bureau visibility", () => {
  test("preparers get the Compliance home; EROs get the rest; the bureau never gets the vault or 8879 records", () => {
    const prep = defaultPermissions();
    assert.equal(can("preparer", prep, "compliance.home"), true);
    for (const k of ["compliance.manage", "compliance.incidents", "compliance.8879", "compliance.vault"]) {
      assert.equal(can("preparer", prep, k), false, k);
      assert.equal(can("ero", {}, k), true, k);
    }
    assert.equal(can("preparer", { ...prep, "compliance.8879": true }, "compliance.8879"), true, "the ERO can hand it to a preparer");
    assert.equal(can("bureau", {}, "compliance.manage"), true);
    assert.equal(can("bureau", {}, "compliance.vault"), false);
    assert.equal(can("bureau", {}, "compliance.8879"), false);
  });

  test("the bureau can't open vault files, even a WISP", async () => {
    const s = setup();
    const doc = await upload(s, s.ero, "wisp", "WISP 2026");
    await assert.rejects(vaultDownload(s.deps, s.bureau, doc.id), /don't have access/);
    assert.match(await vaultDownload(s.deps, s.prep, doc.id), /signed/, "everyone who must acknowledge a WISP can read it");
    const other = await upload(s, s.ero, "training", "Phishing training");
    await assert.rejects(vaultDownload(s.deps, s.prep, other.id), /don't have access/);
  });
});

describe("WISP attestation", () => {
  test("build with the shared engine, attest (who, when, next review), and each member acknowledges once", async () => {
    const s = setup();
    const doc = await buildWisp(s.deps, s.ero, WISP, "Monarch Tax Suite");
    assert.equal(doc.kind, "wisp");
    assert.ok(s.store.objects.get(doc.file_path)!.bytes.length > 1000);
    assert.equal((await lastAnswers(s.deps, OFFICE))?.firm_name, "Bayou Tax LLC", "answers kept sealed for next year");
    await assert.rejects(attest(s.deps, s.ero, { documentId: doc.id, name: "Erin Ero", confirm: false }), /Tick the box/);
    await assert.rejects(attest(s.deps, s.bureau, { documentId: doc.id, name: "Admin", confirm: true }), /ERO attests/);
    await assert.rejects(attest(s.deps, s.prep, { documentId: doc.id, name: "Pat", confirm: true }), /don't have access/);
    const att = await attest(s.deps, s.ero, { documentId: doc.id, name: "Erin Ero", confirm: true });
    assert.deepEqual([att.source, att.review_due, att.attested_name], ["built", "2027-10-20", "Erin Ero"]);
    await acknowledge(s.deps, s.prep, att.id);
    await acknowledge(s.deps, s.prep, att.id);
    assert.equal(s.repo.acks.length, 1);
    await assert.rejects(acknowledge(s.deps, s.bureau, att.id), /team members/);
  });

  test("an uploaded WISP can be attested; the office's own schedule sets the next review", async () => {
    const s = setup();
    await saveSettings(s.deps, s.ero, { review_months: "6", review_reminder_days: "14, 3", retention_alert_days: "60", ptin_reminder_every_days: "7", liaison_name: "Sam Liaison" });
    const doc = await upload(s, s.ero, "wisp", "Our WISP");
    const att = await attest(s.deps, s.ero, { documentId: doc.id, name: "Erin Ero", confirm: true });
    assert.deepEqual([att.source, att.review_due], ["uploaded", "2027-04-20"]);
    await assert.rejects(attest(s.deps, s.ero, { documentId: (await upload(s, s.ero, "training")).id, name: "Erin Ero", confirm: true }), /Choose the WISP/);
  });
});

describe("Form 8879", () => {
  test("recorded with both dates; the vault file gets the same retention; early deletion warns and needs a reason", async () => {
    const s = setup();
    const file = await upload(s, s.ero);
    const rec = await create8879(s.deps, s.ero, { tax_year: "2025", return_ref: "SMITH-1", taxpayer_name: "Jo Smith", signed_on: "2026-02-10", location: "vault", due_date: "2026-04-15", received_date: "2026-04-20", document_id: file.id });
    assert.equal(rec.retention_until, "2029-04-20");
    assert.equal((await s.repo.getDocument(file.id))!.retention_until, "2029-04-20");
    const moved = await update8879(s.deps, s.ero, rec.id, { tax_year: "2025", return_ref: "SMITH-1", taxpayer_name: "Jo Smith", signed_on: "2026-02-10", location: "vault", due_date: "2026-10-15", received_date: "2026-04-20" });
    assert.equal(moved.retention_until, "2029-10-15", "an extension moves the retention end");
    assert.equal((await s.repo.getDocument(file.id))!.retention_until, "2029-10-15");

    await assert.rejects(delete8879(s.deps, s.ero, rec.id, {}), /Required by IRS: this record must be kept for 3 years from October 15, 2026\. Deleting it early is your decision\..*give a reason/);
    const r = await delete8879(s.deps, s.ero, rec.id, { reason: "Duplicate entry" });
    assert.equal(r.early, true);
    const ev = s.repo.events.find((e) => e.action === "deleted_early" && e.entity === "8879")!;
    assert.deepEqual([ev.actor_name, ev.reason, ev.detail.vault_file_kept], ["Erin Ero", "Duplicate entry", true]);
    assert.ok(await s.repo.getDocument(file.id), "deleting the record doesn't delete the vault PDF");

    await assert.rejects(deleteDocument(s.deps, s.ero, file.id, {}), /Required by IRS/);
    await deleteDocument(s.deps, s.ero, file.id, { reason: "Wrong client's file" });
    assert.equal(s.store.objects.has(file.file_path), false);
    assert.ok(s.repo.events.some((e) => e.entity === "document" && e.action === "deleted_early" && e.reason === "Wrong client's file"));
  });

  test("past retention: deleting needs no reason; preparers and other offices can't reach records", async () => {
    const s = setup("2030-01-10T15:00:00Z");
    const rec = await create8879(s.deps, s.ero, { tax_year: "2025", return_ref: "OLD-1", taxpayer_name: "Old", signed_on: "2026-02-10", location: "paper", due_date: "2026-04-15" });
    await assert.rejects(delete8879(s.deps, s.prep, rec.id, {}), /don't have access/);
    await assert.rejects(delete8879(s.deps, { ...s.ero, officeId: OTHER }, rec.id, {}), /wasn't found/);
    assert.deepEqual(await delete8879(s.deps, s.ero, rec.id, {}), { early: false });
    await assert.rejects(create8879(s.deps, s.ero, { tax_year: "2025", return_ref: "X", taxpayer_name: "X", signed_on: "2026-02-30", location: "paper", due_date: "2026-04-15" }), /isn't a valid date/);
  });
});

describe("incidents", () => {
  test("anyone can report; the checklist is recorded; closing with the FTC rule unmet needs a reason", async () => {
    const s = setup();
    const inc = await startIncident(s.deps, s.prep, { title: "Laptop stolen", discovered_on: "2026-10-18", people_affected: "1,200", info_encrypted: "unknown" });
    assert.equal(inc.people_affected, 1200);
    await assert.rejects(markStep(s.deps, s.prep, inc.id, { step: "contain", state: "done" }), /don't have access/);
    await markStep(s.deps, s.ero, inc.id, { step: "contain", state: "done", note: "Wiped remotely" });
    await markStep(s.deps, s.ero, inc.id, { step: "police", state: "skip", note: "Not a crime" });
    const st = await officeStatus(s.deps, OFFICE);
    assert.equal(st.incidents.open, 1);
    await assert.rejects(closeIncident(s.deps, s.ero, inc.id, {}), /Required by FTC: the FTC notice isn't recorded\. .*steps are still open\..*give a reason/);
    const closed = await closeIncident(s.deps, s.ero, inc.id, { reason: "Handled by our attorney" });
    assert.equal(closed.status, "closed");
    const ev = s.repo.events.find((e) => e.action === "closed_with_open_items")!;
    assert.equal(ev.reason, "Handled by our attorney");
    assert.equal(ev.detail.ftc_required, true);
    assert.ok(!JSON.stringify(s.repo.incidents).match(/\d{3}-\d{2}-\d{4}/), "no SSNs");
  });
});

describe("PTIN and office items", () => {
  test("a preparer records their own renewal; only managers record for others", async () => {
    const s = setup();
    await recordRenewal(s.deps, s.prep, { memberId: PREP_M, renewed: "yes", renewedOn: "2026-10-19" });
    await assert.rejects(recordRenewal(s.deps, s.prep, { memberId: ERO_M, renewed: "yes", renewedOn: "" }), /don't have access/);
    const r = await recordRenewal(s.deps, s.ero, { memberId: ERO_M, renewed: "yes", renewedOn: "" });
    assert.deepEqual([r.renewal_year, r.renewed_on], [2027, "2026-10-20"]);
    assert.deepEqual((await officeStatus(s.deps, OFFICE)).ptin, { inSeason: true, year: 2027, renewed: 2, of: 2 });
  });

  test("a yearly item moves its due date a year on when done", async () => {
    const s = setup();
    const item = await createItem(s.deps, s.ero, { title: "Shred old files", due_on: "2026-11-01", repeat: "yearly" });
    const done = await setItemDone(s.deps, s.ero, item.id, true);
    assert.deepEqual([done.due_on, done.done_by_name], ["2027-11-01", "Erin Ero"]);
    await assert.rejects(createItem(s.deps, s.prep, { title: "X" }), /don't have access/);
  });
});

describe("reminders", () => {
  test("WISP review emails go to EROs once per reminder day and once when overdue; PTIN only to those not renewed", async () => {
    const s = setup("2026-09-01T15:00:00Z");
    const doc = await upload(s, s.ero, "wisp", "WISP");
    await saveSettings(s.deps, s.ero, { review_months: "3", review_reminder_days: "30, 7", retention_alert_days: "90", ptin_reminder_every_days: "14" });
    await attest(s.deps, s.ero, { documentId: doc.id, name: "Erin Ero", confirm: true }); // due 2026-12-01

    s.set("2026-10-01T15:00:00Z");
    assert.equal((await runComplianceSweep(s.deps)).sent, 0, "out of the window and out of PTIN season");

    s.set("2026-11-01T15:00:00Z");
    await recordRenewal(s.deps, s.ero, { memberId: ERO_M, renewed: "yes", renewedOn: "" });
    await runComplianceSweep(s.deps);
    await runComplianceSweep(s.deps);
    assert.deepEqual(s.sent.map((m) => [m.to, m.subject]), [["ero@example.com", "Bayou Tax: WISP review due in 30 days"], ["prep@example.com", "Renew your PTIN for 2027"]]);

    s.set("2026-11-25T15:00:00Z");
    await runComplianceSweep(s.deps);
    s.set("2026-12-02T15:00:00Z");
    await runComplianceSweep(s.deps);
    await runComplianceSweep(s.deps);
    const subjects = s.sent.map((m) => m.subject);
    assert.ok(subjects.includes("Bayou Tax: WISP review due in 6 days"));
    assert.equal(subjects.filter((x) => x === "Bayou Tax: WISP review overdue").length, 1);
    assert.ok(s.sent.every((m) => m.to !== "ero@example.com" || !/PTIN/.test(m.subject)), "renewed members aren't nagged");
    assert.match(s.sent[0].text, /Required by IRS \(Publication 5708\)[\s\S]*\nhttps:\/\/app\.test\/office\/compliance\/wisp/);
  });

  test("a held-back email (Preview) is recorded and not retried; a failed one is retried", async () => {
    const s = setup("2026-10-20T15:00:00Z");
    s.failMail("Not sent: Preview only emails test recipients.");
    const r = await runComplianceSweep(s.deps);
    assert.equal(r.heldBack, 2);
    assert.equal((await runComplianceSweep(s.deps)).skipped, 2);
    const t = setup("2026-10-20T15:00:00Z");
    t.failMail("Provider down");
    await runComplianceSweep(t.deps);
    t.failMail(null);
    assert.equal((await runComplianceSweep(t.deps)).sent, 2);
  });
});

describe("dashboard alerts", () => {
  test("worst first, with links into the Compliance Center", () => {
    const alerts = officeAlerts({
      review: { state: "overdue", due: "2026-10-01", days: -19 }, acks: { done: 1, of: 3 }, ptin: { inSeason: true, year: 2027, renewed: 1, of: 3 },
      incidents: { open: 1, ftcOverdue: 1 }, records8879: { total: 10, ending: 2, past: 1 }, items: { overdue: 1, dueSoon: 0 },
    });
    assert.equal(alerts[0].title, "FTC notice past its deadline");
    assert.ok(alerts.some((a) => a.title === "WISP review overdue" && a.href === "/office/compliance/wisp"));
    assert.ok(alerts.some((a) => a.title === "2 PTINs not renewed for 2027"));
    assert.ok(alerts.some((a) => a.href === "/office/compliance/8879?view=past"));
  });
});
