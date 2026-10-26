import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { makePdf } from "./documents-engine.test.ts";
import { MemoryDocumentStore, MemoryDocumentsRepo } from "./documents-memory.ts";
import { finishVersionUpload, setConsentText, startVersionUpload, type DocumentDeps } from "../lib/documents/service.ts";
import { ASK_FIELD, askLabel, isMergeField } from "../lib/documents/fields.ts";
import { clientDocumentValues } from "../lib/documents/values.ts";
import { askFieldsFor, sendToClient, type SigningClient } from "../lib/portal/signing.ts";
import { Keyring } from "../lib/ssn/keyring.ts";
import { hasStoredSsn, ssnForDocument, storeSsn, type KeyRow, type SsnDeps, type SsnRepo } from "../lib/ssn/service.ts";

const TENANT = "00000000-0000-4000-8000-0000000000a1";
const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const CONSENT = "I agree to use electronic records and signatures for this document, and I can ask for a paper copy.";
const NOW = new Date("2027-02-01T15:00:00Z");

class SsnMemory implements SsnRepo {
  key: KeyRow | null = null;
  ct = new Map<string, string>();
  audits: string[] = [];
  async clientExists() { return true; }
  async getKey() { return this.key; }
  async insertKey(r: KeyRow) { if (this.key) return false; this.key = r; return true; }
  async listKeys() { return []; }
  async saveWrappedKey() {}
  async getCiphertext(id: string) { return this.ct.get(id) ?? null; }
  async putCiphertext(id: string, c: string) { this.ct.set(id, c); }
  async deleteCiphertext(id: string) { this.ct.delete(id); }
  async setLast4() {}
  async audit(e: { action: string }) { this.audits.push(e.action); }
  async listAudit() { return []; }
}

async function setup(fields: string[]) {
  const repo = new MemoryDocumentsRepo(TENANT);
  const store = new MemoryDocumentStore();
  const docs: DocumentDeps = { tenantId: TENANT, repo, store, linkKey: randomBytes(32), now: () => NOW };
  await repo.saveProfile(TENANT, { legal_name: "Test Tax Office LLC", display_name: "Test Tax Office", email: "office@example.com", phone: "(555) 010-0000", address: "1 Example St", ptin: "P01234567", caf_number: "1234-56789", time_zone: "America/Chicago" });
  const pdf = await makePdf(fields, { signatureBox: true });
  const t = await startVersionUpload(docs, { fileName: "form.pdf", name: "Test form", sizeBytes: pdf.byteLength, adminId: "a" });
  store.put(t.version.storage_path, pdf, t.contentType);
  const { document } = await finishVersionUpload(docs, t.version.id, "a");
  await setConsentText(docs, document.id, CONSENT, "a");
  const ssnRepo = new SsnMemory();
  const ssn: SsnDeps = { tenantId: TENANT, keyring: new Keyring(new Map([[1, Buffer.alloc(32, 7)]])), repo: ssnRepo };
  return { docs, store, ssn, ssnRepo, document };
}
const client: SigningClient = { id: CLIENT, full_name: "Test Client", email: "client@example.com", phone: "(555) 010-0001", address: "9 Sample Rd", ssn_last4: "6789", archived_at: null };

describe("ask-at-send fields", () => {
  test("ask.<key> is a merge field; the known ones have plain labels", () => {
    assert.ok(isMergeField("ask.tax_matters"));
    assert.ok(ASK_FIELD.test("ask.form_numbers"));
    assert.ok(!isMergeField("ask."));
    assert.ok(!isMergeField("ask.Bad"));
    assert.match(askLabel("ask.tax_years"), /Years or periods/);
    assert.equal(askLabel("ask.some_other_thing"), "some other thing");
  });
  test("new client and firm fields exist", () => {
    for (const f of ["client_address", "client_phone", "client_ssn", "client_ssn_last4", "firm_ptin", "firm_caf_number"]) assert.ok(isMergeField(f), f);
  });
  test("client values come from the client's record and the firm profile", async () => {
    const { docs } = await setup([]);
    const v = clientDocumentValues({ profile: await docs.repo.getProfile(), client, now: NOW });
    assert.equal(v.client_name, "Test Client");
    assert.equal(v.client_first_name, "Test");
    assert.equal(v.client_address, "9 Sample Rd");
    assert.equal(v.client_ssn_last4, "6789");
    assert.equal(v.firm_ptin, "P01234567");
    assert.equal(v.firm_caf_number, "1234-56789");
    assert.equal(v.client_ssn, undefined, "the full number is never part of the ordinary values");
  });
});

describe("sending a form for signature", () => {
  const F8821 = ["client_name", "client_address", "client_ssn", "firm_name", "firm_caf_number", "firm_ptin", "ask.tax_matters", "ask.form_numbers", "ask.tax_years"];

  test("lists the fields staff must fill at send time", async () => {
    const { docs, document } = await setup(F8821);
    assert.deepEqual((await askFieldsFor(docs, document.id)).map((a) => a.name), ["ask.form_numbers", "ask.tax_matters", "ask.tax_years"]);
  });

  test("refuses until every ask field is filled, then fills the copy, ties it to the client, and uses the stored SSN", async () => {
    const { docs, store, ssn, ssnRepo, document } = await setup(F8821);
    await storeSsn(ssn, { clientId: CLIENT, ssn: "123-45-6789", actorId: "s1" });
    await assert.rejects(sendToClient({ docs, ssn, now: () => NOW }, { documentId: document.id, kind: "signature", client, asks: { "ask.tax_matters": "Income tax" }, actorId: "s1" }), /Fill in: .*Tax form numbers.*Years or periods/);
    const made = await sendToClient({ docs, ssn, now: () => NOW }, { documentId: document.id, kind: "signature", client, asks: { "ask.tax_matters": "Income tax", "ask.form_numbers": "1040", "ask.tax_years": "2023 through 2025" }, actorId: "s1" });
    assert.equal(made.delivery.client_id, CLIENT);
    assert.equal(made.delivery.kind, "signature");
    assert.equal(made.delivery.recipient_email, "client@example.com");
    assert.ok(made.delivery.storage_path.startsWith(`${TENANT}/deliveries/`));
    assert.ok(made.signature);
    // Fields are filled with the right words; the signing box stays open.
    const filled = await PDFDocument.load((await store.download(made.delivery.storage_path))!);
    const text = (n: string) => filled.getForm().getTextField(n).getText();
    assert.equal(text("client_name"), "Test Client");
    assert.equal(text("client_ssn"), "123-45-6789");
    assert.equal(text("firm_caf_number"), "1234-56789");
    assert.equal(text("ask.tax_years"), "2023 through 2025");
    assert.deepEqual(ssnRepo.audits, ["ssn.stored", "ssn.filled_document"]);
  });

  test("a form that needs the SSN is refused when none is on file; the audit records no number", async () => {
    const { docs, ssn, ssnRepo, document } = await setup(["client_name", "client_ssn"]);
    await assert.rejects(sendToClient({ docs, ssn, now: () => NOW }, { documentId: document.id, kind: "signature", client, asks: {}, actorId: "s1" }), /no Social Security number on file/);
    assert.deepEqual(ssnRepo.audits, []);
    assert.equal(await hasStoredSsn(ssn, CLIENT), false);
  });

  test("a form without an SSN field never touches the stored number", async () => {
    const { docs, ssn, ssnRepo, document } = await setup(["client_name", "firm_name"]);
    await storeSsn(ssn, { clientId: CLIENT, ssn: "123456789", actorId: "s1" });
    await sendToClient({ docs, ssn, now: () => NOW }, { documentId: document.id, kind: "signature", client, asks: {}, actorId: "s1" });
    assert.deepEqual(ssnRepo.audits, ["ssn.stored"]);
  });

  test("a document can also be sent to read: no signature request, no reminders, still tied to the client", async () => {
    const { docs, ssn, document } = await setup(["client_name", "firm_name"]);
    const made = await sendToClient({ docs, ssn, now: () => NOW }, { documentId: document.id, kind: "send", client, asks: {}, actorId: "s1" });
    assert.equal(made.delivery.kind, "send");
    assert.equal(made.delivery.client_id, CLIENT);
    assert.equal(made.signature, null);
    assert.deepEqual((await docs.repo.listDeliveriesForClient(CLIENT, 10)).map((d) => d.id), [made.delivery.id]);
  });

  test("needs a client email and an active client", async () => {
    const { docs, ssn, document } = await setup(["client_name"]);
    await assert.rejects(sendToClient({ docs, ssn }, { documentId: document.id, kind: "signature", client: { ...client, email: null }, asks: {}, actorId: null }), /Add the client's email/);
    await assert.rejects(sendToClient({ docs, ssn }, { documentId: document.id, kind: "signature", client: { ...client, archived_at: "2027-01-01" }, asks: {}, actorId: null }), /archived/);
  });

  test("the full number never appears in what a use writes to the audit trail, and the decrypt is bound to the client", async () => {
    const { ssn, ssnRepo } = await setup([]);
    await storeSsn(ssn, { clientId: CLIENT, ssn: "987654321", actorId: "s1" });
    assert.equal(await ssnForDocument(ssn, { clientId: CLIENT, actorId: "s1", documentName: "8821" }), "987-65-4321");
    assert.ok(!JSON.stringify(ssnRepo.audits).includes("987"));
    // A ciphertext copied to another client does not open.
    const other = "00000000-0000-4000-8000-0000000000c2";
    ssnRepo.ct.set(other, ssnRepo.ct.get(CLIENT)!);
    await assert.rejects(ssnForDocument(ssn, { clientId: other, actorId: "s1", documentName: "8821" }), /couldn't be read/);
  });
});
