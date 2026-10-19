import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { MemoryRepo } from "./memory-repo.ts";
import { MemoryAutomationRepo } from "./automation-memory.ts";
import { MemoryDocumentStore, MemoryDocumentsRepo } from "./documents-memory.ts";
import { makePdf, makeDocx } from "./documents-engine.test.ts";
import { createProduct, editProduct } from "../lib/commerce/catalog.ts";
import { emitEvent, retryExecution, runTest, type AutomationDeps } from "../lib/automation/engine.ts";
import { validateWorkflowInput, type WorkflowCatalog } from "../lib/automation/validate.ts";
import type { EmailMessage, EmailSender, SendResult } from "../lib/automation/email.ts";
import type { EmailDomainRow, PackageAttribute, SenderRow, SendersRepo } from "../lib/automation/senders.ts";
import { finishVersionUpload, setConsentText, startVersionUpload, type DocumentDeps } from "../lib/documents/service.ts";
import type { NewProduct } from "../lib/commerce/types.ts";
import type { NewWorkflow } from "../lib/automation/types.ts";

// Phase 2 Step 1, Piece 1: the "send document" and "request signature" workflow steps, sending identities, and
// conditions on a tenant's own package attributes.

const TENANT = "00000000-0000-4000-8000-0000000000a1";

class FakeEmail implements EmailSender {
  sent: EmailMessage[] = [];
  queue: SendResult[] = [];
  async send(m: EmailMessage): Promise<SendResult> {
    const next = this.queue.shift();
    if (next) { if (next.ok) this.sent.push(m); return next; }
    this.sent.push(m);
    return { ok: true, id: `msg_${this.sent.length}` };
  }
}

class MemorySenders implements SendersRepo {
  domains: EmailDomainRow[] = [];
  senders: SenderRow[] = [];
  attributes: PackageAttribute[] = [];
  async listDomains() { return this.domains; }
  async deleteDomain(id: string) { this.domains = this.domains.filter((d) => d.id !== id); }
  async deleteSender(id: string) { this.senders = this.senders.filter((s) => s.id !== id); }
  async getDomain(id: string) { return this.domains.find((d) => d.id === id) ?? null; }
  async insertDomain(input: Pick<EmailDomainRow, "domain" | "provider_domain_id" | "status" | "dns_records" | "created_by">) { const d = { ...input, id: randomUUID(), tenant_id: TENANT, last_checked_at: null, created_at: "", updated_at: "" }; this.domains.push(d); return d; }
  async updateDomain(id: string, patch: Partial<EmailDomainRow>) { const d = this.domains.find((x) => x.id === id)!; Object.assign(d, patch); return d; }
  async listSenders() { return this.senders; }
  async getSender(id: string) { return this.senders.find((s) => s.id === id) ?? null; }
  async insertSender(input: Pick<SenderRow, "domain_id" | "from_name" | "local_part" | "reply_to" | "created_by">) { const s = { ...input, id: randomUUID(), tenant_id: TENANT, is_default: false, archived_at: null, created_at: "" }; this.senders.push(s); return s; }
  async updateSender(id: string, patch: Partial<SenderRow>) { const s = this.senders.find((x) => x.id === id)!; Object.assign(s, patch); return s; }
  async setDefaultSender(id: string) { for (const s of this.senders) s.is_default = s.id === id; }
  async listPackageAttributes() { return this.attributes; }
  async insertPackageAttribute(input: Pick<PackageAttribute, "key" | "label" | "kind" | "options">) { const a = { ...input, id: randomUUID(), tenant_id: TENANT, created_at: "" }; this.attributes.push(a); return a; }
  async updatePackageAttribute(id: string, patch: Partial<PackageAttribute>) { const a = this.attributes.find((x) => x.id === id)!; Object.assign(a, patch); return a; }
  async deletePackageAttribute(id: string) { this.attributes = this.attributes.filter((a) => a.id !== id); }
}

const PACKAGE: NewProduct = {
  slug: "tier-two-package", name: "Tier 2 Package", description: "Service bureau package.", product_type: "service", access_type: "manual",
  installation_options: [], price_cents: 39900, currency: "usd", stripe_product_id: "prod_TIER2TEST", stripe_price_id: null, status: "draft",
  metadata: { flow_type: "standard_ero", service_deliverable: "Setup", service_owner: "Team", service_response_time: "2 days" },
};

async function setup(opts: { env?: "production" | "preview"; senders?: boolean } = {}) {
  const commerce = new MemoryRepo();
  const product = await createProduct(commerce, PACKAGE);
  const customer = await commerce.createCustomer({ email: "ana@example.com", full_name: "Ana Ruiz", stripe_customer_id: null });
  const { order } = await commerce.createOrder({
    order_type: "purchase", customer_id: customer.id, product_id: product.id, amount_cents: 39900, amount_refunded_cents: 0, currency: "usd", payment_status: "paid",
    provider: "stripe", provider_payment_intent_id: "pi_TIER2TEST0001", provider_checkout_session_id: null, installation_type: null, license_id: null, tax_year: null,
    previous_tax_year: null, verification_method: "stripe_webhook", verified_by: null, verified_at: new Date().toISOString(), notes: null, paid_at: "2026-10-13T12:00:00Z", refunded_at: null,
  });
  const docRepo = new MemoryDocumentsRepo(TENANT);
  await docRepo.saveProfile(TENANT, { legal_name: "Acme Tax LLC", display_name: "Acme Tax", email: "office@acmetax.test", phone: "(555) 010-2000", address: "1 Main St" });
  const store = new MemoryDocumentStore();
  const documents: DocumentDeps = { tenantId: TENANT, repo: docRepo, store, linkKey: randomBytes(32) };
  const senders = new MemorySenders();
  const email = new FakeEmail();
  const repo = new MemoryAutomationRepo();
  const deps: AutomationDeps = {
    repo, commerce, crm: null, email, documents, senders: opts.senders === false ? null : senders,
    fallbackSender: { from: "Monarch Tax Suite <support@verexahq.com>", replyTo: null, label: "platform" },
    config: { origin: () => "https://app.test", supportEmail: "support@acmetax.test", supportRecipient: "office@acmetax.test", env: opts.env ?? "production", testRecipients: [] },
  };
  const upload = async (fileName: string, bytes: Uint8Array) => {
    const t = await startVersionUpload(documents, { fileName, sizeBytes: bytes.byteLength, adminId: "admin" });
    store.put(t.version.storage_path, bytes);
    return (await finishVersionUpload(documents, t.version.id, "admin")).document;
  };
  return { commerce, product, customer, order, docRepo, store, documents, senders, email, repo, deps, upload };
}

const workflow = (actions: NewWorkflow["actions"], conditions: NewWorkflow["conditions"] = []): NewWorkflow => ({
  workflow_key: null, name: "Onboarding", description: null, trigger_event: "service.order_created", conditions, actions, status: "active", max_attempts: 4, cooldown_hours: 0, created_by: null, updated_by: null,
});

describe("send document step", () => {
  test("fills the document for the customer, emails one secure link, and raises document.sent once", async () => {
    const s = await setup();
    const doc = await s.upload("welcome.pdf", await makePdf(["client_name", "firm_name", "product_name", "amount_paid"]));
    await s.repo.insertWorkflow(workflow([{ type: "send_document", document_id: doc.id, sender_id: null, message: "Welcome aboard.", link_days: 14 }]));
    const ev = { type: "service.order_created", key: `order:${s.order.id}:service_created`, customerId: s.customer.id, orderId: s.order.id };
    await emitEvent(s.deps, ev);
    await emitEvent(s.deps, ev);
    assert.equal(s.docRepo.deliveries.length, 1);
    assert.equal(s.email.sent.length, 1);
    const [m] = s.email.sent;
    assert.equal(m.to, "ana@example.com");
    assert.match(m.text, /https:\/\/app\.test\/d\/[A-Za-z0-9_-]{40,}/);
    assert.match(m.text, /Welcome aboard\./);
    assert.equal(m.from, "Monarch Tax Suite <support@verexahq.com>", "no own sender yet: the platform fallback");
    assert.deepEqual(s.repo.events.map((e) => e.event_type), ["service.order_created", "document.sent"]);
    assert.equal(s.repo.events[1].data.document_id, doc.id);
  });

  test("a failed email is retried with the same copy and the same link", async () => {
    const s = await setup();
    const doc = await s.upload("welcome.pdf", await makePdf(["client_name"]));
    await s.repo.insertWorkflow(workflow([{ type: "send_document", document_id: doc.id, sender_id: null, message: "", link_days: 14 }]));
    s.email.queue.push({ ok: false, kind: "permanent", message: "Mailbox full" });
    await emitEvent(s.deps, { type: "service.order_created", key: "o1", customerId: s.customer.id, orderId: s.order.id });
    assert.equal(s.repo.executions[0].status, "failed");
    await retryExecution(s.deps, s.repo.executions[0].id, "admin");
    assert.equal(s.docRepo.deliveries.length, 1, "same copy");
    assert.equal(s.email.sent.length, 1);
    assert.match(s.repo.executions[0].action_log[0].detail, /same copy as the earlier attempt/);
  });

  test("a merge field with no value fails the step with the reason, and nothing is sent", async () => {
    const s = await setup();
    await s.docRepo.saveProfile(TENANT, { phone: null });
    const doc = await s.upload("welcome.pdf", await makePdf(["client_name", "firm_phone"]));
    await s.repo.insertWorkflow(workflow([{ type: "send_document", document_id: doc.id, sender_id: null, message: "", link_days: 14 }]));
    await emitEvent(s.deps, { type: "service.order_created", key: "o1", customerId: s.customer.id, orderId: s.order.id });
    assert.equal(s.repo.executions[0].status, "failed");
    assert.equal(s.repo.executions[0].error_kind, "config");
    assert.match(s.repo.executions[0].error ?? "", /firm_phone/);
    assert.equal(s.email.sent.length, 0);
  });

  test("test runs use sample data and go only to the test recipient", async () => {
    const s = await setup();
    const doc = await s.upload("welcome.pdf", await makePdf(["client_name"]));
    const wf = await s.repo.insertWorkflow(workflow([{ type: "send_document", document_id: doc.id, sender_id: null, message: "", link_days: 14 }]));
    await runTest(s.deps, wf.id, { id: "admin", email: "admin@acmetax.test" });
    assert.equal(s.email.sent[0].to, "admin@acmetax.test");
    assert.match(s.email.sent[0].subject, /^\[TEST\]/);
    assert.equal(s.docRepo.deliveries[0].is_test, true);
    assert.equal(s.repo.events.filter((e) => e.event_type === "document.sent").length, 0, "no real event from a test");
  });

  test("outside production, customers are not emailed", async () => {
    const s = await setup({ env: "preview" });
    const doc = await s.upload("welcome.pdf", await makePdf(["client_name"]));
    await s.repo.insertWorkflow(workflow([{ type: "send_document", document_id: doc.id, sender_id: null, message: "", link_days: 14 }]));
    await emitEvent(s.deps, { type: "service.order_created", key: "o1", customerId: s.customer.id, orderId: s.order.id });
    assert.equal(s.email.sent.length, 0);
    assert.equal(s.docRepo.deliveries.length, 0);
  });
});

describe("request signature step", () => {
  test("sends a signing link for a PDF with the tenant's consent text", async () => {
    const s = await setup();
    const doc = await s.upload("engagement.pdf", await makePdf(["client_name", "signer_name"], { signatureBox: true }));
    await setConsentText(s.documents, doc.id, "We use electronic signatures. By ticking the box you agree to sign electronically.", "admin");
    await s.repo.insertWorkflow(workflow([{ type: "request_signature", document_id: doc.id, sender_id: null, message: "", link_days: 7, reminder_days: 3 }]));
    await emitEvent(s.deps, { type: "service.order_created", key: "o1", customerId: s.customer.id, orderId: s.order.id });
    assert.match(s.email.sent[0].text, /https:\/\/app\.test\/sign\//);
    assert.match(s.email.sent[0].subject, /Please sign: engagement/);
    assert.equal(s.docRepo.signatures[0].reminder_days, 3);
    assert.match(s.docRepo.signatures[0].consent_text, /We use electronic signatures/);
  });
});

describe("sending identities", () => {
  async function withSenders() {
    const s = await setup();
    const verified = await s.senders.insertDomain({ domain: "acmetax.test", provider_domain_id: "d1", status: "verified", dns_records: [], created_by: null });
    const pending = await s.senders.insertDomain({ domain: "brand-two.test", provider_domain_id: "d2", status: "pending", dns_records: [], created_by: null });
    const main = await s.senders.insertSender({ domain_id: verified.id, from_name: "Acme Tax", local_part: "office", reply_to: "help@acmetax.test", created_by: null });
    const brand = await s.senders.insertSender({ domain_id: pending.id, from_name: "Brand Two", local_part: "hello", reply_to: null, created_by: null });
    await s.senders.setDefaultSender(main.id);
    const doc = await s.upload("welcome.pdf", await makePdf(["client_name"]));
    return { ...s, main, brand, doc };
  }

  test("the default sender is used, from the tenant's own domain", async () => {
    const s = await withSenders();
    await s.repo.insertWorkflow(workflow([{ type: "send_document", document_id: s.doc.id, sender_id: null, message: "", link_days: 14 }]));
    await emitEvent(s.deps, { type: "service.order_created", key: "o1", customerId: s.customer.id, orderId: s.order.id });
    assert.equal(s.email.sent[0].from, '"Acme Tax" <office@acmetax.test>');
    assert.equal(s.email.sent[0].replyTo, "help@acmetax.test");
  });

  test("a chosen sender on an unverified domain fails the step instead of sending from anywhere else", async () => {
    const s = await withSenders();
    await s.repo.insertWorkflow(workflow([{ type: "send_document", document_id: s.doc.id, sender_id: s.brand.id, message: "", link_days: 14 }]));
    await emitEvent(s.deps, { type: "service.order_created", key: "o1", customerId: s.customer.id, orderId: s.order.id });
    assert.equal(s.email.sent.length, 0);
    assert.match(s.repo.executions[0].error ?? "", /not verified yet/);
  });

  test("an email template can choose which brand it sends from", async () => {
    const s = await withSenders();
    const second = await s.senders.insertSender({ domain_id: s.main.domain_id, from_name: "Acme Billing", local_part: "billing", reply_to: null, created_by: null });
    const t = await s.repo.insertTemplate({ template_key: null, name: "Receipt", subject: "Thanks {{customer_first_name}}", body: "Thank you.", active: true, created_by: null, updated_by: null, sender_id: second.id });
    await s.repo.insertWorkflow(workflow([{ type: "send_email", template_id: t.id, to: "customer", include_setup_link: false }]));
    await emitEvent(s.deps, { type: "service.order_created", key: "o1", customerId: s.customer.id, orderId: s.order.id });
    assert.equal(s.email.sent[0].from, '"Acme Billing" <billing@acmetax.test>');
  });
});

describe("package attributes route documents", () => {
  test("conditions test the tenant's own product attributes, whatever they are called", async () => {
    const s = await setup();
    const a = await s.upload("ero-packet.pdf", await makePdf(["client_name"]));
    const b = await s.upload("ptin-packet.pdf", await makePdf(["client_name"]));
    await s.repo.insertWorkflow(workflow([{ type: "send_document", document_id: a.id, sender_id: null, message: "", link_days: 14 }], [{ field: "product.flow_type", op: "eq", value: "standard_ero" }]));
    await s.repo.insertWorkflow(workflow([{ type: "send_document", document_id: b.id, sender_id: null, message: "", link_days: 14 }], [{ field: "product.flow_type", op: "eq", value: "ptin_holder" }]));
    await emitEvent(s.deps, { type: "service.order_created", key: "o1", customerId: s.customer.id, orderId: s.order.id });
    assert.deepEqual(s.docRepo.deliveries.map((d) => d.document_id), [a.id]);

    await editProduct(s.commerce, s.product.id, { ...PACKAGE, metadata: { ...PACKAGE.metadata, flow_type: "ptin_holder" } });
    await emitEvent(s.deps, { type: "service.order_created", key: "o2", customerId: s.customer.id, orderId: s.order.id });
    assert.deepEqual(s.docRepo.deliveries.map((d) => d.document_id), [a.id, b.id]);
  });

  test("saving a workflow checks attributes, documents, senders and PDF-only signing against the tenant's own records", () => {
    const catalog: WorkflowCatalog = {
      documents: [{ id: "11111111-1111-4111-8111-111111111111", name: "Letter", file_type: "docx", status: "active" }, { id: "22222222-2222-4222-8222-222222222222", name: "Engagement", file_type: "pdf", status: "active" }],
      senders: [{ id: "33333333-3333-4333-8333-333333333333" }],
      attributes: [{ key: "mentorship", label: "Mentorship", kind: "choice", options: ["yes", "no"] }],
    };
    const base = { name: "Route", trigger_event: "service.order_created", conditions: [] as { field: string; op: string; value: string }[], actions: [{ type: "send_document", document_id: "22222222-2222-4222-8222-222222222222" }] };
    assert.equal(validateWorkflowInput({ ...base, conditions: [{ field: "product.mentorship", op: "eq", value: "yes" }] }, [], catalog).conditions[0].field, "product.mentorship");
    assert.throws(() => validateWorkflowInput({ ...base, conditions: [{ field: "product.flow_type", op: "eq", value: "x" }] }, [], catalog), /not one of your package attributes/);
    assert.throws(() => validateWorkflowInput({ ...base, conditions: [{ field: "product.mentorship", op: "eq", value: "maybe" }] }, [], catalog), /accepts: yes, no/);
    assert.throws(() => validateWorkflowInput({ ...base, actions: [{ type: "request_signature", document_id: "11111111-1111-4111-8111-111111111111" }] }, [], catalog), /Only PDFs can be signed/);
    assert.throws(() => validateWorkflowInput({ ...base, actions: [{ type: "send_document", document_id: "44444444-4444-4444-8444-444444444444" }] }, [], catalog), /Choose a document from your library/);
    assert.throws(() => validateWorkflowInput({ ...base, actions: [{ type: "send_document", document_id: "22222222-2222-4222-8222-222222222222", sender_id: "55555555-5555-4555-8555-555555555555" }] }, [], catalog), /sending addresses/);
    const sig = validateWorkflowInput({ ...base, actions: [{ type: "request_signature", document_id: "22222222-2222-4222-8222-222222222222", reminder_days: "3", link_days: "7" }] }, [], catalog);
    assert.deepEqual(sig.actions[0], { type: "request_signature", document_id: "22222222-2222-4222-8222-222222222222", sender_id: null, message: "", link_days: 7, reminder_days: 3 });
  });

  test("Word documents still send", async () => {
    const s = await setup();
    const doc = await s.upload("letter.docx", makeDocx("<w:p><w:r><w:t>Hi {{client_first_name}}</w:t></w:r></w:p>"));
    await s.repo.insertWorkflow(workflow([{ type: "send_document", document_id: doc.id, sender_id: null, message: "", link_days: 14 }]));
    await emitEvent(s.deps, { type: "service.order_created", key: "o1", customerId: s.customer.id, orderId: s.order.id });
    assert.match(s.docRepo.deliveries[0].storage_path, /\.docx$/);
  });
});
