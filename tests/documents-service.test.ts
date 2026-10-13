import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { MemoryDocumentStore, MemoryDocumentsRepo } from "./documents-memory.ts";
import { makeDocx, makePdf } from "./documents-engine.test.ts";
import {
  createDelivery, declineSignature, downloadFromLink, fileLink, finishVersionUpload, MissingValuesError, removeDocument, resolveLink,
  revokeDelivery, setConsentText, signDocument, startVersionUpload, sweepSignatures, type DocumentDeps,
} from "../lib/documents/service.ts";
import { sha256Hex } from "../lib/documents/files.ts";

// Phase 2 Step 1, Piece 1: library, versions, deliveries and signing, against in-memory storage.

const TENANT_A = "00000000-0000-4000-8000-0000000000a1";
const TENANT_B = "00000000-0000-4000-8000-0000000000b2";
const CONSENT = "I agree to use electronic records and signatures for this document, and I can ask for a paper copy.";

function setup(tenantId = TENANT_A, clock = { t: new Date("2026-10-13T12:00:00Z") }) {
  const repo = new MemoryDocumentsRepo(tenantId);
  const store = new MemoryDocumentStore();
  const deps: DocumentDeps = { tenantId, repo, store, linkKey: randomBytes(32), now: () => clock.t };
  return { repo, store, deps, clock };
}

async function upload(deps: DocumentDeps, store: MemoryDocumentStore, fileName: string, bytes: Uint8Array, documentId?: string) {
  const t = await startVersionUpload(deps, { documentId, fileName, sizeBytes: bytes.byteLength, adminId: "admin" });
  store.put(t.version.storage_path, bytes, t.contentType);
  return finishVersionUpload(deps, t.version.id, "admin");
}

const base = { recipientEmail: "ana@example.com", recipientName: "Ana Ruiz", customerId: null, orderId: null, isTest: false, linkDays: 14, createdBy: null };
const values = { client_name: "Ana Ruiz", firm_name: "Acme Tax", signer_name: "", signed_date: "" };

describe("library and versions", () => {
  test("uploads land in the tenant's folder; each replacement is a new version; merge fields are recorded", async () => {
    const { deps, store, repo } = setup();
    const first = await upload(deps, store, "letter.docx", makeDocx("<w:p><w:r><w:t>Hi {{client_name}}</w:t></w:r></w:p>"));
    assert.ok(first.version.storage_path.startsWith(`${TENANT_A}/versions/${first.document.id}/`));
    assert.deepEqual(first.version.merge_fields, ["client_name"]);
    const second = await upload(deps, store, "letter-v2.docx", makeDocx("<w:p><w:r><w:t>Hi {{client_name}} from {{firm_name}}</w:t></w:r></w:p>"), first.document.id);
    assert.equal(second.version.version, 2);
    assert.equal((await repo.getDocument(first.document.id))?.current_version_id, second.version.id);
    await assert.rejects(startVersionUpload(deps, { documentId: first.document.id, fileName: "x.pdf", sizeBytes: 10, adminId: "a" }), /Upload a \.docx file/);
  });

  test("a bad file is rejected, removed from storage, and a brand-new document is not left behind", async () => {
    const { deps, store, repo } = setup();
    await assert.rejects(upload(deps, store, "fake.pdf", new TextEncoder().encode("MZ not a pdf")), /not a PDF/);
    assert.equal(repo.documents.length, 0);
    assert.equal(store.objects.size, 0);
    await assert.rejects(upload(deps, store, "typo.docx", makeDocx("<w:p><w:r><w:t>{{clinet_name}}</w:t></w:r></w:p>")), /Unknown merge field/);
  });

  test("a document that was sent can only be archived; one never sent is deleted with its files", async () => {
    const { deps, store } = setup();
    const unsent = await upload(deps, store, "unsent.pdf", await makePdf([]));
    assert.equal(await removeDocument(deps, unsent.document.id, "admin"), "deleted");
    assert.equal(store.objects.size, 0);
    const sent = await upload(deps, store, "sent.pdf", await makePdf(["client_name"]));
    await createDelivery(deps, { ...base, documentId: sent.document.id, kind: "send", executionId: null, actionIndex: null, values });
    assert.equal(await removeDocument(deps, sent.document.id, "admin"), "archived");
  });
});

describe("sending", () => {
  test("a filled, fingerprinted copy is saved once per workflow step, with a secure link", async () => {
    const { deps, store, repo } = setup();
    const doc = await upload(deps, store, "welcome.pdf", await makePdf(["client_name", "firm_name"]));
    const input = { ...base, documentId: doc.document.id, kind: "send" as const, executionId: "11111111-1111-4111-8111-111111111111", actionIndex: 0, values };
    const first = await createDelivery(deps, input);
    const again = await createDelivery(deps, input);
    assert.equal(repo.deliveries.length, 1, "a retried run does not make a second copy");
    assert.equal(again.reused, true);
    assert.equal(again.token, first.token, "and keeps the same link");
    assert.ok(first.delivery.storage_path.startsWith(`${TENANT_A}/deliveries/`));
    assert.equal(first.delivery.sha256, sha256Hex(store.objects.get(first.delivery.storage_path)!.bytes));
    assert.notEqual(first.delivery.token_hash, first.token, "only a hash of the token is stored");
    const link = await downloadFromLink(deps, first.token);
    assert.match(link, /t=60$/, "60-second link");
    assert.equal((await repo.getDelivery(first.delivery.id))?.download_count, 1);
  });

  test("a merge field with no value fails instead of sending a blank", async () => {
    const { deps, store, repo } = setup();
    const doc = await upload(deps, store, "welcome.pdf", await makePdf(["client_name", "firm_phone"]));
    await assert.rejects(createDelivery(deps, { ...base, documentId: doc.document.id, kind: "send", executionId: null, actionIndex: null, values }), (e) => e instanceof MissingValuesError && /firm_phone/.test(e.message));
    assert.equal(repo.deliveries.length, 0);
  });

  test("a new version does not change copies already sent", async () => {
    const { deps, store } = setup();
    const doc = await upload(deps, store, "terms.pdf", await makePdf(["client_name"]));
    const sent = await createDelivery(deps, { ...base, documentId: doc.document.id, kind: "send", executionId: null, actionIndex: null, values });
    await upload(deps, store, "terms-v2.pdf", await makePdf(["client_name", "firm_name"]), doc.document.id);
    assert.equal(sent.delivery.version_id, doc.version.id);
    assert.equal(sha256Hex(store.objects.get(sent.delivery.storage_path)!.bytes), sent.delivery.sha256);
  });

  test("expired and revoked links stop working", async () => {
    const { deps, store, clock } = setup();
    const doc = await upload(deps, store, "notice.pdf", await makePdf(["client_name"]));
    const a = await createDelivery(deps, { ...base, documentId: doc.document.id, kind: "send", executionId: null, actionIndex: null, values, linkDays: 1 });
    const b = await createDelivery(deps, { ...base, documentId: doc.document.id, kind: "send", executionId: null, actionIndex: null, values });
    await revokeDelivery(deps, b.delivery.id, "admin");
    assert.deepEqual(await resolveLink(deps, b.token), { ok: false, reason: "revoked" });
    clock.t = new Date("2026-10-15T12:00:00Z");
    assert.deepEqual(await resolveLink(deps, a.token), { ok: false, reason: "expired" });
    assert.deepEqual(await resolveLink(deps, "nope"), { ok: false, reason: "not_found" });
  });
});

describe("signing", () => {
  async function requestSignature(opts: { reminderDays?: number; linkDays?: number } = {}) {
    const s = setup();
    const doc = await upload(s.deps, s.store, "engagement.pdf", await makePdf(["client_name", "signer_name", "signed_date"], { signatureBox: true }));
    await assert.rejects(createDelivery(s.deps, { ...base, documentId: doc.document.id, kind: "signature", executionId: null, actionIndex: null, values }), /no signing consent statement/);
    await setConsentText(s.deps, doc.document.id, CONSENT, "admin");
    const made = await createDelivery(s.deps, { ...base, documentId: doc.document.id, kind: "signature", executionId: null, actionIndex: null, values, reminderDays: opts.reminderDays ?? null, linkDays: opts.linkDays ?? 14 });
    return { ...s, doc, made };
  }
  const sign = { consent: true, signedName: "Ana Ruiz", mark: { method: "typed" as const, text: "Ana Ruiz" }, ipHash: "c".repeat(16), userAgent: "Test", firmName: "Acme Tax", timeZone: "America/New_York" };

  test("only PDFs can be signed", async () => {
    const { deps, store } = setup();
    const doc = await upload(deps, store, "letter.docx", makeDocx("<w:p><w:r><w:t>Hi</w:t></w:r></w:p>"));
    await setConsentText(deps, doc.document.id, CONSENT, "admin");
    await assert.rejects(createDelivery(deps, { ...base, documentId: doc.document.id, kind: "signature", executionId: null, actionIndex: null, values }), /Only PDFs can be signed/);
  });

  test("the tenant's own consent text is captured; signing needs consent; it signs once and records the evidence", async () => {
    const { deps, store, made } = await requestSignature();
    assert.equal(made.signature?.consent_text, CONSENT);
    await assert.rejects(signDocument(deps, made.token, { ...sign, consent: false }), /consent box/);
    const { request } = await signDocument(deps, made.token, sign);
    assert.equal(request.status, "signed");
    assert.ok(request.signed_storage_path?.startsWith(`${TENANT_A}/signed/`));
    const signedBytes = store.objects.get(request.signed_storage_path!)!.bytes;
    assert.equal(request.signed_sha256, sha256Hex(signedBytes));
    assert.equal((await PDFDocument.load(signedBytes)).getPageCount(), 2, "certificate page");
    await assert.rejects(signDocument(deps, made.token, sign), /already signed/);
    assert.match(await downloadFromLink(deps, made.token), /signed/);
  });

  test("declined and expired requests close; reminders come due", async () => {
    const declined = await requestSignature();
    assert.equal((await declineSignature(declined.deps, declined.made.token, "Wrong name")).request.status, "declined");
    await assert.rejects(signDocument(declined.deps, declined.made.token, sign), /already declined/);

    const r = await requestSignature({ reminderDays: 3, linkDays: 7 });
    // The in-memory repo stamps created_at with the real clock, so reminders are measured from now.
    r.clock.t = new Date(Date.now() + 3 * 86_400_000 + 3_600_000);
    assert.equal((await sweepSignatures(r.deps)).remind.length, 1);
    assert.equal((await sweepSignatures(r.deps)).remind.length, 0, "not twice in a row");
    r.clock.t = new Date(Math.max(Date.now(), Date.parse("2026-10-13T12:00:00Z")) + 8 * 86_400_000);
    assert.equal((await sweepSignatures(r.deps)).expired.length, 1);
    await assert.rejects(signDocument(r.deps, r.made.token, sign), /expired/);
  });
});

describe("tenant folders", () => {
  test("a tenant can never produce a link to another tenant's file, or a path outside its folder", async () => {
    const { deps } = setup(TENANT_A);
    await assert.rejects(fileLink(deps, `${TENANT_B}/deliveries/x.pdf`, null), /not in this tenant's document folder/);
    await assert.rejects(fileLink(deps, `${TENANT_A}/../${TENANT_B}/x.pdf`, null), /not in this tenant's document folder/);
    const b = setup(TENANT_B);
    const doc = await upload(b.deps, b.store, "tenant-b.pdf", await makePdf(["client_name"]));
    const sent = await createDelivery(b.deps, { ...base, documentId: doc.document.id, kind: "send", executionId: null, actionIndex: null, values });
    // Tenant A's repository holds none of tenant B's rows, so B's link means nothing to A.
    assert.deepEqual(await resolveLink(deps, sent.token), { ok: false, reason: "not_found" });
  });
});
