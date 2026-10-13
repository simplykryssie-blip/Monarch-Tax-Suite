import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { MemoryRepo } from "./memory-repo.ts";
import { MemoryAutomationRepo } from "./automation-memory.ts";
import { MemoryDocumentStore, MemoryDocumentsRepo } from "./documents-memory.ts";
import { MemoryFirms, MemoryFormsRepo } from "./forms-memory.ts";
import { CrmSecrets } from "../lib/crm/crypto.ts";
import type { AutomationDeps } from "../lib/automation/engine.ts";
import type { EmailMessage, EmailSender, SendResult } from "../lib/automation/email.ts";
import type { EmailDomainRow, PackageAttribute, SenderRow, SendersRepo } from "../lib/automation/senders.ts";
import { brandCatalogFrom, cleanLinkHost, formPublicUrl, hostFromHeaders, type Brand } from "../lib/brands.ts";
import { formSender, notifyFirm, sendResumeLink } from "../lib/forms/after.ts";
import { createForm, publicForm, publishForm, saveDraft, saveSettings, type FormDeps } from "../lib/forms/service.ts";
import { checkSettings, readSettings } from "../lib/forms/settings.ts";
import { emptyDefinition, type FormDefinition } from "../lib/forms/definition.ts";

// Firms/brands in one account (for example Monarch and MKB): which firm a form belongs to, the public link's address,
// and which address the form's emails come from.

const TENANT = "00000000-0000-4000-8000-0000000000a1";

class FakeEmail implements EmailSender {
  sent: EmailMessage[] = [];
  async send(m: EmailMessage): Promise<SendResult> {
    this.sent.push(m);
    return { ok: true, id: `msg_${this.sent.length}` };
  }
}

class MemorySenders implements SendersRepo {
  domains: EmailDomainRow[] = [];
  senders: SenderRow[] = [];
  async listDomains() { return this.domains; }
  async getDomain(id: string) { return this.domains.find((d) => d.id === id) ?? null; }
  async insertDomain(input: Pick<EmailDomainRow, "domain" | "provider_domain_id" | "status" | "dns_records" | "created_by">) { const d = { ...input, id: randomUUID(), tenant_id: TENANT, last_checked_at: null, created_at: "", updated_at: "" }; this.domains.push(d); return d; }
  async updateDomain(id: string, patch: Partial<EmailDomainRow>) { const d = this.domains.find((x) => x.id === id)!; Object.assign(d, patch); return d; }
  async listSenders() { return this.senders; }
  async getSender(id: string) { return this.senders.find((s) => s.id === id) ?? null; }
  async insertSender(input: Pick<SenderRow, "domain_id" | "from_name" | "local_part" | "reply_to" | "created_by">) { const s = { ...input, id: randomUUID(), tenant_id: TENANT, is_default: false, archived_at: null, created_at: "" }; this.senders.push(s); return s; }
  async updateSender(id: string, patch: Partial<SenderRow>) { const s = this.senders.find((x) => x.id === id)!; Object.assign(s, patch); return s; }
  async setDefaultSender(id: string) { for (const s of this.senders) s.is_default = s.id === id; }
  async listPackageAttributes(): Promise<PackageAttribute[]> { return []; }
  async insertPackageAttribute(): Promise<PackageAttribute> { throw new Error("unused"); }
  async updatePackageAttribute(): Promise<PackageAttribute> { throw new Error("unused"); }
  async deletePackageAttribute() {}
}

const brand = (over: Partial<Brand> = {}): Brand => ({ id: "d1", name: "Monarch Tax Suite", domain: "monarchtaxsuite.com", linkHost: "monarchtaxsuite.com", verified: true, ...over });

/** A one-question definition that publishes cleanly. */
function simpleDefinition(): FormDefinition {
  const def = emptyDefinition();
  def.pages[0].sections[0].fields.push({ id: "femailaaa", key: "email", type: "email", label: "Email", required: true, width: "full" } as FormDefinition["pages"][0]["sections"][0]["fields"][0]);
  return def;
}

async function setup(opts: { brands: ("monarch" | "mkb")[]; mkbSender?: boolean }) {
  const senders = new MemorySenders();
  const domain = async (name: string, brandName: string, linkHost: string) => {
    const d = await senders.insertDomain({ domain: name, provider_domain_id: null, status: "verified", dns_records: [], created_by: null });
    await senders.updateDomain(d.id, { brand_name: brandName, link_host: linkHost });
    return d;
  };
  const ids: Record<string, string> = {};
  const from: Record<string, string> = {};
  if (opts.brands.includes("monarch")) {
    ids.monarch = (await domain("monarchtaxsuite.com", "Monarch Tax Suite", "monarchtaxsuite.com")).id;
    from.monarch = (await senders.insertSender({ domain_id: ids.monarch, from_name: "Monarch Tax Suite", local_part: "hello", reply_to: null, created_by: null })).id;
    await senders.setDefaultSender(from.monarch);
  }
  if (opts.brands.includes("mkb")) {
    ids.mkb = (await domain("mkb.test", "MKB", "forms.mkb.test")).id;
    if (opts.mkbSender !== false) from.mkb = (await senders.insertSender({ domain_id: ids.mkb, from_name: "MKB", local_part: "office", reply_to: null, created_by: null })).id;
  }
  const repo = new MemoryFormsRepo(TENANT);
  const docRepo = new MemoryDocumentsRepo(TENANT);
  await docRepo.saveProfile(TENANT, { legal_name: "Acme Tax LLC", display_name: "Acme Tax", email: "office@acmetax.test", time_zone: "America/Chicago" });
  const commerce = new MemoryRepo();
  const deps: FormDeps = {
    tenantId: TENANT, repo, stores: { uploads: new MemoryDocumentStore(), pdfs: new MemoryDocumentStore() }, firms: new MemoryFirms(), commerce,
    secrets: new CrmSecrets(randomBytes(32)), linkKey: randomBytes(32), profile: () => docRepo.getProfile(),
    brandCatalog: async () => brandCatalogFrom(await senders.listDomains(), await senders.listSenders()),
  };
  const email = new FakeEmail();
  const auto: AutomationDeps = {
    repo: new MemoryAutomationRepo(), commerce, crm: null, email, documents: { tenantId: TENANT, repo: docRepo, store: new MemoryDocumentStore(), linkKey: randomBytes(32) }, senders,
    fallbackSender: { from: "Platform <support@platform.test>", replyTo: null, label: "platform" },
    config: { origin: () => "https://app.test", supportEmail: "support@acmetax.test", supportRecipient: "office@acmetax.test", env: "production", testRecipients: [] },
  };
  return { deps, auto, email, repo, senders, ids, from };
}

async function publishedForm(s: Awaited<ReturnType<typeof setup>>, brandId: string | null) {
  const form = await createForm(s.deps, { name: "ERO application", brandDomainId: brandId, adminId: "admin" });
  await saveDraft(s.deps, form.id, simpleDefinition(), "admin");
  await saveSettings(s.deps, form.id, { brand_domain_id: brandId, notify: { recipients: "intake@acmetax.test" } }, Object.values(s.from), "admin");
  await publishForm(s.deps, form.id, "admin");
  return (await s.repo.getForm(form.id))!;
}

async function submitted(s: Awaited<ReturnType<typeof setup>>, formId: string) {
  return s.repo.insertSubmission({ id: randomUUID(), form_id: formId, version_id: (await s.repo.getForm(formId))!.current_version_id!, status: "new", number: 1, answers: {}, submitted_at: new Date().toISOString(), respondent_email: "anh@example.com", is_test: false });
}

describe("the public link", () => {
  test("is built from the request's own host on Preview, never from a stored domain", () => {
    const url = formPublicUrl({ publicId: "Abc123", brand: brand(), requestHost: "monarch-git-forms-piece2-verexa.vercel.app", production: false });
    assert.equal(url, "https://monarch-git-forms-piece2-verexa.vercel.app/f/Abc123");
    assert.equal(formPublicUrl({ publicId: "Abc123", brand: null, requestHost: "localhost:3000", production: false }), "http://localhost:3000/f/Abc123");
  });

  test("uses the form's firm's web address in production", () => {
    assert.equal(formPublicUrl({ publicId: "Abc123", brand: brand(), requestHost: "app.monarchtaxsuite.com", production: true }), "https://monarchtaxsuite.com/f/Abc123");
    assert.equal(formPublicUrl({ publicId: "Abc123", brand: brand({ id: "d2", name: "MKB", linkHost: "forms.mkb.test" }), requestHost: "app.monarchtaxsuite.com", production: true }), "https://forms.mkb.test/f/Abc123");
    assert.equal(formPublicUrl({ publicId: "Abc123", brand: brand({ linkHost: null }), requestHost: "app.monarchtaxsuite.com", production: true }), "https://app.monarchtaxsuite.com/f/Abc123", "no web address set: the request's host");
  });

  test("reads the forwarded host and refuses anything that is not a host", () => {
    const h = (m: Record<string, string>) => ({ get: (n: string) => m[n] ?? null });
    assert.equal(hostFromHeaders(h({ "x-forwarded-host": "Preview-ABC.vercel.app, proxy", host: "internal" })), "preview-abc.vercel.app");
    assert.equal(hostFromHeaders(h({ host: "localhost:3000" })), "localhost:3000");
    assert.equal(hostFromHeaders(h({ host: "evil.test/<script>" })), null);
    assert.equal(hostFromHeaders(h({})), null);
  });

  test("a firm's web address is stored as a bare host", () => {
    assert.equal(cleanLinkHost("https://Forms.MKB.test/f/x"), "forms.mkb.test");
    assert.equal(cleanLinkHost("  "), null);
    assert.throws(() => cleanLinkHost("not a host"), /web address/);
  });
});

describe("choosing the firm", () => {
  test("with one firm, forms belong to it without asking", async () => {
    const s = await setup({ brands: ["monarch"] });
    const form = await createForm(s.deps, { name: "ERO application", adminId: "admin" });
    assert.equal(readSettings(form.settings).brand_domain_id, s.ids.monarch);
  });

  test("with several firms, a new form must say which one it belongs to", async () => {
    const s = await setup({ brands: ["monarch", "mkb"] });
    await assert.rejects(createForm(s.deps, { name: "ERO application", adminId: "admin" }), /Which firm|Choose which firm/);
    await assert.rejects(createForm(s.deps, { name: "ERO application", brandDomainId: randomUUID(), adminId: "admin" }), /Choose which firm/);
    const form = await createForm(s.deps, { name: "ERO application", brandDomainId: s.ids.mkb, adminId: "admin" });
    assert.equal(readSettings(form.settings).brand_domain_id, s.ids.mkb);
  });

  test("a form made before the second firm was added can't be published until its firm is chosen", async () => {
    const s = await setup({ brands: ["monarch", "mkb"] });
    const form = await createForm(s.deps, { name: "Old form", brandDomainId: s.ids.monarch, adminId: "admin" });
    await saveDraft(s.deps, form.id, simpleDefinition(), "admin");
    await s.repo.updateForm(form.id, { settings: { ...readSettings(form.settings), brand_domain_id: null } });
    await assert.rejects(publishForm(s.deps, form.id, "admin"), /Choose which firm this form belongs to/);
    await assert.rejects(saveSettings(s.deps, form.id, {}, Object.values(s.from), "admin"), /Choose which firm/);
  });

  test("the notification address must be one of the form's firm's addresses", () => {
    const def = simpleDefinition();
    const catalog = { brandIds: ["monarch", "mkb"], senderDomain: { s_monarch: "monarch", s_mkb: "mkb" } };
    assert.throws(() => checkSettings({ brand_domain_id: "mkb", notify: { sender_id: "s_monarch" } }, def, ["s_monarch", "s_mkb"], catalog), /must belong to the form's firm/);
    assert.equal(checkSettings({ brand_domain_id: "mkb", notify: { sender_id: "s_mkb" } }, def, ["s_monarch", "s_mkb"], catalog).notify.sender_id, "s_mkb");
    assert.throws(() => checkSettings({ brand_domain_id: "someone-else" }, def, [], catalog), /one of your firms/);
  });
});

describe("the form's emails", () => {
  test("come from the form's firm's address and carry its name", async () => {
    const s = await setup({ brands: ["monarch", "mkb"] });
    const form = await publishedForm(s, s.ids.mkb);
    const from = await formSender(s.auto, s.deps, readSettings(form.settings));
    assert.deepEqual(from, { senderId: s.from.mkb, name: "MKB", blocked: null });
    await notifyFirm(s.auto, s.deps, await submitted(s, form.id));
    assert.equal(s.email.sent.length, 1);
    assert.match(s.email.sent[0].from!, /office@mkb\.test/);
    assert.doesNotMatch(s.email.sent[0].from!, /monarch/i);
  });

  test("a Monarch form sends from Monarch even though MKB has addresses too", async () => {
    const s = await setup({ brands: ["monarch", "mkb"] });
    const form = await publishedForm(s, s.ids.monarch);
    await notifyFirm(s.auto, s.deps, await submitted(s, form.id));
    assert.match(s.email.sent[0].from!, /hello@monarchtaxsuite\.com/);
  });

  test("a firm with no verified address sends nothing rather than borrowing another firm's", async () => {
    const s = await setup({ brands: ["monarch", "mkb"], mkbSender: false });
    const form = await publishedForm(s, s.ids.mkb);
    const sub = await submitted(s, form.id);
    await notifyFirm(s.auto, s.deps, sub);
    assert.equal(s.email.sent.length, 0);
    assert.match((await s.repo.getSubmission(sub.id))!.notify_error!, /MKB has no verified sending address/);
  });

  test("the resume link uses the link the request built", async () => {
    const s = await setup({ brands: ["monarch"] });
    const form = await publishedForm(s, s.ids.monarch);
    const pf = (await publicForm(s.deps, form.public_id))!;
    const formUrl = formPublicUrl({ publicId: form.public_id, brand: brand(), requestHost: "preview-xyz.vercel.app", production: false });
    assert.equal(await sendResumeLink(s.auto, s.deps, { pf, email: "anh@example.com", token: "t".repeat(43), expiresAt: new Date().toISOString(), formUrl }), null);
    assert.match(s.email.sent[0].text, new RegExp(`https://preview-xyz\\.vercel\\.app/f/${form.public_id}\\?resume=t{43}`));
  });
});
