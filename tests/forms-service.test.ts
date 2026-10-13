import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { deflateSync, crc32 } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { MemoryRepo } from "./memory-repo.ts";
import { MemoryAutomationRepo } from "./automation-memory.ts";
import { MemoryDocumentStore, MemoryDocumentsRepo } from "./documents-memory.ts";
import { MemoryFirms, MemoryFormsRepo } from "./forms-memory.ts";
import { sampleDefinition } from "./forms-builder.test.ts";
import { makeDocx } from "./documents-engine.test.ts";
import { CrmSecrets } from "../lib/crm/crypto.ts";
import { emitEvent, type AutomationDeps } from "../lib/automation/engine.ts";
import type { EmailMessage, EmailSender, SendResult } from "../lib/automation/email.ts";
import { validateWorkflowInput } from "../lib/automation/validate.ts";
import { finishVersionUpload, startVersionUpload, type DocumentDeps } from "../lib/documents/service.ts";
import { afterSubmit } from "../lib/forms/after.ts";
import {
  answerStrings, createForm, displayAnswer, emptySpam, exportCsv, makePdf, openAnswers, publicForm, publishForm, receiptLink, removeForm, resumeDraft,
  saveDraft, saveForLater, saveSettings, saveFormDetails, setFormStatus, startStamp, startUpload, submitForm, SubmissionInvalid, sweepForms, uploadLink, type FormDeps,
} from "../lib/forms/service.ts";
import { inputFields } from "../lib/forms/definition.ts";
import type { StoredAnswers } from "../lib/forms/types.ts";

// Phase 2 Step 1, Piece 2: publishing forms, public submissions (uploads, logic, signature, spam, save for later),
// the submission PDF, the customer and firm records, notices, CSV, and the form.submitted workflow event.

const TENANT = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const who = { ipHash: "abc123", userAgent: "test-browser" };
const CONSENT = "I agree to sign this application electronically and that my electronic signature is binding.";

class FakeEmail implements EmailSender {
  sent: EmailMessage[] = [];
  async send(m: EmailMessage): Promise<SendResult> {
    this.sent.push(m);
    return { ok: true, id: `msg_${this.sent.length}` };
  }
}

/** A real PNG of w×h pixels (for drawn signatures and uploaded images). */
export function makePng(w = 120, h = 40): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rows.set([20, 30, (x * 2) % 255, 255], y * (w * 4 + 1) + 1 + x * 4);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]));
}
const JPEG = new Uint8Array(Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64"));
async function onePagePdf(text = "EFIN acceptance letter") {
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]).drawText(text, { x: 20, y: 100, size: 12 });
  return doc.save();
}

async function setup(opts: { env?: "production" | "preview" } = {}) {
  const repo = new MemoryFormsRepo(TENANT);
  const uploads = new MemoryDocumentStore();
  const pdfs = new MemoryDocumentStore();
  const firms = new MemoryFirms();
  const commerce = new MemoryRepo();
  const docRepo = new MemoryDocumentsRepo(TENANT);
  await docRepo.saveProfile(TENANT, { legal_name: "Acme Tax LLC", display_name: "Acme Tax", email: "office@acmetax.test", time_zone: "America/Chicago" });
  let clock = new Date("2026-10-13T15:00:00Z");
  const deps: FormDeps = {
    tenantId: TENANT, repo, stores: { uploads, pdfs }, firms, commerce, secrets: new CrmSecrets(randomBytes(32)), linkKey: randomBytes(32),
    profile: () => docRepo.getProfile(), now: () => clock,
  };
  const docStore = new MemoryDocumentStore();
  const documents: DocumentDeps = { tenantId: TENANT, repo: docRepo, store: docStore, linkKey: randomBytes(32) };
  const email = new FakeEmail();
  const autoRepo = new MemoryAutomationRepo();
  const auto: AutomationDeps = {
    repo: autoRepo, commerce, crm: null, email, documents, senders: null,
    fallbackSender: { from: "Acme Tax <office@acmetax.test>", replyTo: null, label: "Acme" },
    config: { origin: () => "https://app.test", supportEmail: "support@acmetax.test", supportRecipient: "office@acmetax.test", env: opts.env ?? "production", testRecipients: [] },
    formAnswers: (id) => answerStrings(deps, id),
  };
  const advance = (seconds: number) => { clock = new Date(clock.getTime() + seconds * 1000); };

  const form = await createForm(deps, { name: "ERO application", adminId: "admin" });
  await saveDraft(deps, form.id, sampleDefinition(), "admin");
  await saveFormDetails(deps, form.id, { name: "ERO application", description: "", consent: CONSENT }, "admin");
  await saveSettings(deps, form.id, {
    respondent: { email_key: "email", name_key: "full_name" },
    firm: { enabled: true, relationship: "partner", legal_name_key: "business_name", efin_key: "efin", address_key: "office_address", people: [{ role: "ero", name_key: "full_name", email_key: "email", ptin_key: "ptin" }] },
    notify: { recipients: "intake@acmetax.test" },
  }, [], "admin");
  const version = await publishForm(deps, form.id, "admin");
  const fresh = (await repo.getForm(form.id))!;
  return { deps, repo, uploads, pdfs, firms, commerce, email, auto, autoRepo, documents, docStore, form: fresh, version, advance };
}

const ERO_ANSWERS = {
  full_name: "Nguyễn Thị Ánh", email: "anh@example.com", filer_type: "ERO", efin: "123 456", business_name: "Ánh Tax Services LLC",
  office_address: { line1: "1 Main St", line2: "Suite 2", city: "Lake Charles", state: "LA", zip: "70607" }, ptin: "P01234567",
};

/** Uploads a file the way the browser does: ask for a link, then PUT the bytes. */
async function upload(s: Awaited<ReturnType<typeof setup>>, token: string | null, fileName: string, bytes: Uint8Array) {
  const t = await startUpload(s.deps, s.form.public_id, { token, fieldKey: "photo_id", fileName, sizeBytes: bytes.byteLength }, who);
  s.uploads.put(s.repo.uploads.find((u) => u.id === t.uploadId)!.storage_path, bytes, t.contentType);
  return t;
}

async function submitEro(s: Awaited<ReturnType<typeof setup>>, extra: Partial<typeof ERO_ANSWERS> = {}) {
  const stamp = startStamp(s.deps, s.form.id);
  s.advance(30);
  const a = await upload(s, null, "license.jpg", JPEG);
  const b = await upload(s, a.token, "efin-letter.pdf", await onePagePdf());
  return submitForm(s.deps, s.form.public_id, {
    token: a.token, honeypot: "", stamp,
    answers: { ...ERO_ANSWERS, ...extra, photo_id: [{ id: a.uploadId, name: "license.jpg" }, { id: b.uploadId, name: "efin-letter.pdf" }] },
    signature: { consent: true, signedName: "Nguyễn Thị Ánh", method: "drawn", png: makePng() },
  }, who);
}

describe("publishing", () => {
  test("a form needs a question, and a consent statement before a signature field can be published", async () => {
    const s = await setup();
    const empty = await createForm(s.deps, { name: "Empty", adminId: "admin" });
    await assert.rejects(publishForm(s.deps, empty.id, "admin"), /at least one question/);
    const signing = await createForm(s.deps, { name: "Signing", adminId: "admin" });
    await saveDraft(s.deps, signing.id, sampleDefinition(), "admin");
    await assert.rejects(publishForm(s.deps, signing.id, "admin"), /consent statement/);
    assert.equal(s.version.version, 1);
    assert.equal(s.form.status, "published");
  });

  test("an unfinished draft still autosaves, and says what to fix", async () => {
    const s = await setup();
    const d = sampleDefinition();
    d.pages[0].sections[0].fields[0].label = "";
    const r = await saveDraft(s.deps, s.form.id, d, "admin");
    assert.match(r.problem!.message, /needs a label/);
    assert.equal(r.problem!.target, "fnameaaaa");
    assert.equal(((await s.repo.getForm(s.form.id))!.draft_definition as typeof d).pages[0].sections[0].fields[0].label, "");
  });

  test("republishing makes version 2 and earlier submissions keep version 1", async () => {
    const s = await setup();
    const { submission } = await submitEro(s);
    const d = sampleDefinition();
    d.pages[0].sections[0].fields[0].label = "Your legal name";
    await saveDraft(s.deps, s.form.id, d, "admin");
    const v2 = await publishForm(s.deps, s.form.id, "admin");
    assert.equal(v2.version, 2);
    assert.equal((await s.repo.getSubmission(submission.id))!.version_id, s.version.id);
  });

  test("closed, past-date and full forms stop taking submissions", async () => {
    const s = await setup();
    await setFormStatus(s.deps, s.form.id, "closed", "admin");
    assert.equal((await publicForm(s.deps, s.form.public_id))!.state, "closed");
    await setFormStatus(s.deps, s.form.id, "published", "admin");
    await saveSettings(s.deps, s.form.id, { max_submissions: "1", respondent: { email_key: "email", name_key: "full_name" } }, [], "admin");
    await submitEro(s);
    assert.equal((await publicForm(s.deps, s.form.public_id))!.state, "closed");
    await assert.rejects(submitEro(s), /not accepting submissions/);
    await saveSettings(s.deps, s.form.id, { close_at: "2026-10-01T00:00:00Z" }, [], "admin");
    assert.equal((await publicForm(s.deps, s.form.public_id))!.state, "closed");
    assert.equal(await publicForm(s.deps, "notarealformid12"), null);
  });
});

describe("submitting", () => {
  test("a full submission: checked uploads, encrypted identifiers, signature, number, and locked answers", async () => {
    const s = await setup();
    const { submission } = await submitEro(s);
    assert.equal(submission.status, "new");
    assert.equal(submission.number, 1);
    assert.equal(submission.respondent_email, "anh@example.com");
    assert.equal(submission.consent_text, CONSENT);
    assert.equal(submission.signature?.method, "drawn");
    const stored = submission.answers as StoredAnswers;
    assert.deepEqual(stored.efin, { sealed: (stored.efin as { sealed: string }).sealed, last4: "3456" });
    assert.ok(!JSON.stringify(stored).includes("123456"), "the EFIN is never stored readable");
    assert.equal(openAnswers(s.deps, submission).efin, "123456");
    assert.equal(displayAnswer(inputFields(s.version.definition).find((f) => f.key === "efin")!, stored.efin), "•••• 3456");
    assert.equal(s.repo.uploads.filter((u) => u.status === "attached").length, 3, "two files and the drawn signature");
    assert.ok(s.repo.uploads.every((u) => u.storage_path.startsWith(`${TENANT}/forms/${s.form.id}/${submission.id}/`)));
    assert.ok(s.repo.uploads.filter((u) => u.kind === "file").every((u) => /^[0-9a-f]{64}$/.test(u.sha256 ?? "")));
    await assert.rejects(s.repo.updateSubmission(submission.id, { answers: {} }), /cannot be changed/);
    await assert.rejects(submitForm(s.deps, s.form.public_id, { token: null, honeypot: "", stamp: startStamp(s.deps, s.form.id), answers: {}, signature: null }, who), (e) => e instanceof SubmissionInvalid);
  });

  test("files are checked by content, size and count", async () => {
    const s = await setup();
    await assert.rejects(startUpload(s.deps, s.form.public_id, { token: null, fieldKey: "photo_id", fileName: "id.exe", sizeBytes: 100 }, who), /PDF, JPG, PNG files only/);
    await assert.rejects(startUpload(s.deps, s.form.public_id, { token: null, fieldKey: "photo_id", fileName: "id.pdf", sizeBytes: 11 * 1024 * 1024 }, who), /10 MB/);
    await assert.rejects(startUpload(s.deps, s.form.public_id, { token: null, fieldKey: "full_name", fileName: "id.pdf", sizeBytes: 100 }, who), /does not take files/);
    const stamp = startStamp(s.deps, s.form.id);
    s.advance(10);
    const fake = await upload(s, null, "license.pdf", new Uint8Array(Buffer.from("MZ this is really an exe")));
    await assert.rejects(
      submitForm(s.deps, s.form.public_id, { token: fake.token, honeypot: "", stamp, answers: { ...ERO_ANSWERS, photo_id: [{ id: fake.uploadId, name: "license.pdf" }] }, signature: { consent: true, signedName: "Ana", method: "typed", typed: "Ana" } }, who),
      (e) => e instanceof SubmissionInvalid && /not a PDF/.test(e.errors.photo_id),
    );
    assert.equal(s.repo.uploads.find((u) => u.id === fake.uploadId)!.status, "rejected");
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await upload(s, fake.token, `p${i}.png`, makePng())).uploadId);
    await assert.rejects(
      submitForm(s.deps, s.form.public_id, { token: fake.token, honeypot: "", stamp, answers: { ...ERO_ANSWERS, photo_id: ids.map((id) => ({ id, name: "p.png" })) }, signature: { consent: true, signedName: "Ana", method: "typed", typed: "Ana" } }, who),
      (e) => e instanceof SubmissionInvalid && /at most 2 files/.test(e.errors.photo_id),
    );
  });

  test("the signature needs consent, and the server ignores answers to hidden questions", async () => {
    const s = await setup();
    const stamp = startStamp(s.deps, s.form.id);
    s.advance(10);
    const a = await upload(s, null, "id.png", makePng());
    const base = { token: a.token, honeypot: "", stamp, answers: { ...ERO_ANSWERS, filer_type: "PTIN holder", photo_id: [{ id: a.uploadId, name: "id.png" }] } };
    await assert.rejects(submitForm(s.deps, s.form.public_id, { ...base, signature: { consent: false, signedName: "Ana Ruiz", method: "typed", typed: "Ana Ruiz" } }, who), (e) => e instanceof SubmissionInvalid && /agree to sign/.test(e.errors.signature));
    const { submission } = await submitForm(s.deps, s.form.public_id, { ...base, signature: { consent: true, signedName: "Ana Ruiz", method: "typed", typed: "Ana Ruiz" } }, who);
    const stored = submission.answers as StoredAnswers;
    assert.equal(stored.efin, undefined, "a PTIN holder never saw the EFIN question");
    assert.equal(stored.business_name, undefined, "the office page was skipped");
  });

  test("suspected spam is kept, marked, and notifies no one", async () => {
    const s = await setup();
    const fast = startStamp(s.deps, s.form.id);
    const a = await upload(s, null, "x.png", makePng());
    const { submission } = await submitForm(s.deps, s.form.public_id, { token: a.token, honeypot: "http://spam.example", stamp: fast, answers: { ...ERO_ANSWERS, filer_type: "PTIN holder", photo_id: [{ id: a.uploadId, name: "x.png" }] }, signature: { consent: true, signedName: "Bot", method: "typed", typed: "Bot" } }, who);
    assert.equal(submission.status, "spam");
    assert.match(submission.spam_reason ?? "", /hidden field|too fast/);
    await afterSubmit(s.auto, s.deps, submission, (await publicForm(s.deps, s.form.public_id))!);
    assert.equal(s.email.sent.length, 0);
    assert.equal(s.autoRepo.events.length, 0);
    assert.equal(await emptySpam(s.deps, s.form.id, "admin"), 1);
    assert.equal(s.repo.submissions.length, 0);
  });

  test("save and continue later keeps the answers and uploads, and the link finishes the same submission", async () => {
    const s = await setup();
    const a = await upload(s, null, "id.png", makePng());
    const saved = await saveForLater(s.deps, s.form.public_id, { token: a.token, answers: { full_name: "Ana Ruiz", efin: "654321", photo_id: [{ id: a.uploadId, name: "id.png" }] }, email: "ana@example.com" }, who);
    assert.equal(saved.token, a.token);
    assert.ok(!JSON.stringify(s.repo.submissions[0].answers).includes("654321"), "sensitive draft answers are encrypted too");
    const pf = (await publicForm(s.deps, s.form.public_id))!;
    const resumed = (await resumeDraft(s.deps, pf, saved.token))!;
    assert.equal(resumed.answers.efin, "654321");
    assert.deepEqual(resumed.answers.photo_id, [{ id: a.uploadId, name: "id.png" }]);
    assert.equal(await resumeDraft(s.deps, pf, "x".repeat(43)), null);
    const stamp = startStamp(s.deps, s.form.id);
    s.advance(20);
    const { submission } = await submitForm(s.deps, s.form.public_id, { token: saved.token, honeypot: "", stamp, answers: { ...ERO_ANSWERS, ...resumed.answers, filer_type: "ERO", efin: "654321" }, signature: { consent: true, signedName: "Ana Ruiz", method: "typed", typed: "Ana Ruiz" } }, who);
    assert.equal(submission.id, saved.draft.id);
    assert.equal(submission.draft_token_hash, null);
    assert.equal(await resumeDraft(s.deps, pf, saved.token), null, "a used link no longer opens the draft");
    // Abandoned drafts disappear with their files.
    const b = await upload(s, null, "lost.png", makePng());
    s.advance(25 * 3600);
    const swept = await sweepForms(s.deps);
    assert.equal(swept.draftsRemoved, 1);
    assert.ok(!s.repo.uploads.some((u) => u.id === b.uploadId));
  });
});

describe("the submission PDF", () => {
  test("one document with answers, embedded files, signature and timestamps; non-Latin names print", async () => {
    const s = await setup();
    const { submission } = await submitEro(s);
    const done = await makePdf(s.deps, submission.id);
    assert.equal(done.pdf_path, `${TENANT}/submissions/${submission.id}.pdf`);
    assert.match(done.pdf_sha256 ?? "", /^[0-9a-f]{64}$/);
    const pdf = await PDFDocument.load(s.pdfs.objects.get(done.pdf_path!)!.bytes);
    // Answers page(s) + the image's page + a cover page for the uploaded PDF + its one page.
    assert.ok(pdf.getPageCount() >= 4, `got ${pdf.getPageCount()} pages`);
    assert.equal(pdf.getTitle(), "ERO application, submission #1");
    assert.ok(s.repo.events.some((e) => e.type === "pdf_made"));
  });

  test("the confirmation download needs the browser's receipt token and expires after an hour", async () => {
    const s = await setup();
    const { submission, receiptToken } = await submitEro(s);
    assert.match(await receiptLink(s.deps, submission.id, receiptToken), /signed\//);
    await assert.rejects(receiptLink(s.deps, submission.id, "y".repeat(43)), /expired/);
    s.advance(61 * 60);
    await assert.rejects(receiptLink(s.deps, submission.id, receiptToken), /expired/);
  });
});

describe("after a submission", () => {
  test("links the purchase customer, creates the firm, notifies without answers, confirms, and raises form.submitted once", async () => {
    const s = await setup();
    const buyer = await s.commerce.createCustomer({ email: "anh@example.com", full_name: "Anh Nguyen", stripe_customer_id: null });
    s.repo.orders.push({ id: randomUUID(), customer_id: buyer.id, paid_at: "2026-10-12T10:00:00Z" });
    const { submission, pf } = await submitEro(s);
    await afterSubmit(s.auto, s.deps, submission, pf);
    const after = (await s.repo.getSubmission(submission.id))!;
    assert.equal(after.customer_id, buyer.id, "linked to the customer from the purchase");
    assert.equal(after.firm_status, "created");
    const firm = s.firms.orgs[0];
    assert.equal(firm.customer_id, buyer.id);
    assert.equal(firm.legal_name, "Ánh Tax Services LLC");
    const payload = firm.payload as { efin: { efin_last4: string; efin_encrypted: string }; people: { role: string; ptin_last4: string }[]; address: { line1: string } };
    assert.equal(payload.efin.efin_last4, "3456");
    assert.equal(s.deps.secrets.decrypt(payload.efin.efin_encrypted, `efin:${(payload.efin as unknown as { efin_id: string }).efin_id}:efin`), "123456", "encrypted the way My Service Bureau reads it");
    assert.equal(payload.people[0].role, "ero");
    assert.equal(payload.people[0].ptin_last4, "4567");
    assert.equal(payload.address.line1, "1 Main St, Suite 2");
    assert.ok(after.pdf_path);
    const notice = s.email.sent.find((m) => m.to === "intake@acmetax.test")!;
    assert.match(notice.subject, /New submission #1: ERO application/);
    assert.ok(!/123456|P01234567|Lake Charles/.test(notice.text + notice.html), "no answers in the notice");
    const confirm = s.email.sent.find((m) => m.to === "anh@example.com")!;
    assert.match(confirm.subject, /We received your submission/);
    assert.ok(after.notified_at && after.confirmation_sent_at);
    const events = s.autoRepo.events.filter((e) => e.event_type === "form.submitted");
    assert.equal(events.length, 1);
    assert.equal(events[0].customer_id, buyer.id);
    assert.equal(events[0].order_id, s.repo.orders[0].id);
    await afterSubmit(s.auto, s.deps, after, pf);
    assert.equal(s.autoRepo.events.filter((e) => e.event_type === "form.submitted").length, 1, "never twice");
  });

  test("creates the customer when there is none, links a second submission to the same firm, and records a firm failure", async () => {
    const s = await setup();
    const first = await submitEro(s);
    await afterSubmit(s.auto, s.deps, first.submission, first.pf);
    const c = await s.commerce.findCustomerByEmail("anh@example.com");
    assert.ok(c, "customer created");
    const second = await submitEro(s, { email: "office@anhtax.example" });
    await afterSubmit(s.auto, s.deps, second.submission, second.pf);
    const s2 = (await s.repo.getSubmission(second.submission.id))!;
    assert.equal(s2.firm_status, "linked", "same EFIN, same firm");
    assert.equal(s2.organization_id, s.firms.orgs[0].id);
    assert.equal(s.firms.orgs.length, 1);
    const third = await submitEro(s, { email: "new@other.example", efin: "999999" });
    await afterSubmit(s.auto, s.deps, third.submission, third.pf);
    const s3 = (await s.repo.getSubmission(third.submission.id))!;
    assert.equal(s3.firm_status, "failed");
    assert.match(s3.firm_error ?? "", /PTIN on this submission is already recorded/);
    assert.equal(s3.status, "new", "the submission itself is unaffected");
  });

  test("workflows route on answers and fill {{form.<key>}} merge fields", async () => {
    const s = await setup();
    const docx = makeDocx("<w:p><w:r><w:t>Welcome {{form.business_name}}, filing as {{form.filer_type}}.</w:t></w:r></w:p>");
    const t = await startVersionUpload(s.documents, { fileName: "welcome.docx", sizeBytes: docx.byteLength, adminId: "admin" });
    s.docStore.put(t.version.storage_path, docx);
    const { document } = await finishVersionUpload(s.documents, t.version.id, "admin");
    const catalog = { documents: [{ ...document, merge_fields: ["form.business_name", "form.filer_type"] }], senders: [], attributes: [], forms: [{ id: s.form.id, name: s.form.name, questions: inputFields(s.version.definition).map((q) => ({ key: q.key, label: q.label, type: q.type, options: q.options ?? [] })) }] };
    const input = (conds: { field: string; op: string; value: string }[]) => ({ name: "Welcome EROs", trigger_event: "form.submitted", conditions: conds, actions: [{ type: "send_document", document_id: document.id, link_days: "14" }] });
    assert.throws(() => validateWorkflowInput(input([]), [], catalog), /uses form answers/);
    assert.throws(() => validateWorkflowInput(input([{ field: "form_id", op: "eq", value: s.form.id }, { field: "answer.filer_type", op: "eq", value: "CPA" }]), [], catalog), /accepts: ERO, PTIN holder/);
    assert.throws(() => validateWorkflowInput(input([{ field: "form_id", op: "eq", value: s.form.id }, { field: "answer.full_name", op: "eq", value: "x" }]), [], catalog), /dropdown and radio/);
    const wf = validateWorkflowInput(input([{ field: "form_id", op: "eq", value: s.form.id }, { field: "answer.filer_type", op: "eq", value: "ERO" }]), [], catalog);
    await s.autoRepo.insertWorkflow({ ...wf, workflow_key: null, status: "active", created_by: null, updated_by: null });
    const { submission, pf } = await submitEro(s);
    await afterSubmit(s.auto, s.deps, submission, pf);
    const sent = s.email.sent.find((m) => /sent you a document/.test(m.subject));
    assert.ok(sent, "the document went out");
    const delivery = (await s.documents.repo.listDeliveries(document.id, 5))[0];
    const filled = s.docStore.objects.get(delivery.storage_path)!.bytes;
    const xml = new (await import("pizzip")).default(filled).file("word/document.xml")!.asText();
    assert.match(xml, /Welcome Ánh Tax Services LLC, filing as ERO\./);
    // A PTIN holder's submission does not match the condition.
    const before = s.email.sent.length;
    const ptinEvent = await emitEvent(s.auto, { type: "form.submitted", key: "manual-ptin", data: { form_id: s.form.id, submission_id: (await submitEro(s, { filer_type: "PTIN holder", email: "p@x.example" })).submission.id } });
    assert.equal(ptinEvent.executionIds.length, 0);
    assert.equal(s.email.sent.length, before);
  });
});

describe("admin records", () => {
  test("CSV keeps identifiers masked, leaves out files, defuses formulas, and is recorded", async () => {
    const s = await setup();
    await submitEro(s, { business_name: "=HYPERLINK(\"http://evil.example\")" });
    const { csv, fileName } = await exportCsv(s.deps, s.form.id, "admin");
    assert.equal(fileName, "ERO application submissions.csv");
    assert.ok(!csv.includes("123456") && csv.includes("•••• 3456"));
    assert.ok(!/photo id/i.test(csv.split("\r\n")[0]));
    assert.ok(csv.includes(`"'=HYPERLINK(""http://evil.example"")"`));
    assert.ok(s.repo.events.some((e) => e.type === "exported" && e.actor_id === "admin"));
  });

  test("submissions are never deleted; a form with submissions is archived instead", async () => {
    const s = await setup();
    const { submission } = await submitEro(s);
    await assert.rejects(s.repo.deleteSubmissions([submission.id]), /cannot be deleted/);
    assert.equal(await removeForm(s.deps, s.form.id, "admin"), "archived");
    const other = await createForm(s.deps, { name: "Never used", adminId: "admin" });
    assert.equal(await removeForm(s.deps, other.id, "admin"), "deleted");
  });

  test("file links are made only for this tenant's folder", async () => {
    const s = await setup();
    const { submission } = await submitEro(s);
    const file = s.repo.uploads.find((u) => u.submission_id === submission.id && u.kind === "file")!;
    assert.match(await uploadLink(s.deps, file.id, "admin", false), /signed\//);
    file.storage_path = `${OTHER}/forms/${s.form.id}/${submission.id}/${randomUUID()}`;
    await assert.rejects(uploadLink(s.deps, file.id, "admin", false), /Refused/);
  });
});
