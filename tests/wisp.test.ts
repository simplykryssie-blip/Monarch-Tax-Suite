import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { MemoryRepo, published, seedCheckout } from "./memory-repo.ts";
import { MemoryDocumentStore } from "./documents-memory.ts";
import { createProduct } from "../lib/commerce/catalog.ts";
import { handleStripeEvent, type FulfillmentDeps } from "../lib/commerce/fulfillment.ts";
import { publishBlockers } from "../lib/commerce/validation.ts";
import type { NewProduct } from "../lib/commerce/types.ts";
import { CrmSecrets } from "../lib/crm/crypto.ts";
import { captureAuditLead, convertFromPurchase } from "../lib/leads/service.ts";
import { MemoryLeads } from "./leads-memory.ts";
import { calculateScore, checkAnswers, checkAudit, comparisonFee, feeComparison, numberDraft, numberInput, QUESTIONS, scoreVerdict } from "../lib/wisp/content.ts";
import {
  downloadUrl, fulfilPaidPlan, LINK_DAYS, planForBuyer, planForLink, recordAudit, resendForBuyer, startPlan,
  type WispAudit, type WispDelivery, type WispDeps, type WispMailer, type WispPlan, type WispRepo,
} from "../lib/wisp/service.ts";

// WISP Generator: the owner's scoring and rules, the plan saved before payment, delivery after the verified webhook
// (PDF filed, emailed with the file attached), retries, and downloads that only the buyer can reach.

const TENANT = "00000000-0000-4000-8000-0000000000a1";

class MemoryWisp implements WispRepo {
  audits: WispAudit[] = [];
  plans: WispPlan[] = [];
  deliveries: WispDelivery[] = [];
  private c = <T>(v: T): T => structuredClone(v);
  async insertAudit(input: Omit<WispAudit, "id" | "tenant_id" | "created_at">) { const a = { ...this.c(input), id: randomUUID(), tenant_id: TENANT, created_at: new Date().toISOString() }; this.audits.push(a); return this.c(a); }
  async getAudit(id: string) { return this.c(this.audits.find((a) => a.id === id) ?? null); }
  async insertPlan(input: Pick<WispPlan, "id" | "audit_id" | "firm_name" | "email" | "answers_sealed" | "access_token_hash">) {
    const p: WispPlan = { ...this.c(input), tenant_id: TENANT, status: "draft", link_token_hash: null, link_expires_at: null, stripe_session_id: null, customer_id: null, order_id: null, pdf_path: null, pdf_sha256: null, generated_at: null, emailed_at: null, email_error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    this.plans.push(p);
    return this.c(p);
  }
  async getPlan(id: string) { return this.c(this.plans.find((p) => p.id === id) ?? null); }
  async findPlanBySession(s: string) { return this.c(this.plans.find((p) => p.stripe_session_id === s) ?? null); }
  async findPlanByLinkHash(h: string) { return this.c(this.plans.find((p) => p.link_token_hash === h) ?? null); }
  async updatePlan(id: string, patch: Partial<WispPlan>) { const p = this.plans.find((x) => x.id === id)!; Object.assign(p, this.c(patch)); return this.c(p); }
  async listPlans(opts: { customerId?: string; limit: number }) { return this.c(this.plans.filter((p) => !opts.customerId || p.customer_id === opts.customerId)); }
  async listAudits() { return this.c(this.audits); }
  async addDelivery(input: Omit<WispDelivery, "id" | "tenant_id" | "created_at">) { this.deliveries.unshift({ ...this.c(input), id: randomUUID(), tenant_id: TENANT, created_at: (this.clock?.() ?? new Date()).toISOString() }); }
  async listDeliveries(planId: string) { return this.c(this.deliveries.filter((d) => d.plan_id === planId)); }
  clock?: () => Date;
}

const ANSWERS = {
  firm_name: "Ánh Tax Services LLC", owner_name: "Nguyễn Thị Ánh", ein: "12-3456789", address: "1 Main St, Lake Charles, LA", phone: "(337) 555-0100",
  tax_software: "TaxSlayer Pro", data_locations: "TaxSlayer cloud; encrypted office NAS", backup_method: "Encrypted cloud backup daily",
  num_users: "3", mfa_status: "MFA on all systems", access_policy: "Owner grants access by role; removed the day someone leaves.",
  encryption: "Encrypted in transit and at rest", physical_security: "Locked cabinets, clean desk, 10-minute auto-lock.", training: "Annual training completed",
  ir_contact: "Nguyễn Thị Ánh, owner", ir_steps: "1. Contain 2. Assess 3. Notify IRS Stakeholder Liaison and FTC", review_date: "January 2027",
};

function setup(opts: { mail?: WispMailer } = {}) {
  const repo = new MemoryWisp();
  const store = new MemoryDocumentStore();
  let clock = new Date("2026-10-13T15:00:00Z");
  repo.clock = () => clock;
  const sent: Parameters<WispMailer>[0][] = [];
  const deps: WispDeps = {
    tenantId: TENANT, repo, store, secrets: new CrmSecrets(randomBytes(32)),
    send: opts.mail ?? (async (m) => { sent.push(m); return null; }),
    brand: async () => ({ name: "Monarch Tax Suite", origin: "https://app.monarchtaxsuite.test" }),
    now: () => clock,
  };
  return { deps, repo, store, sent, advance: (s: number) => { clock = new Date(clock.getTime() + s * 1000); } };
}

describe("the audit (owner's rules, unchanged)", () => {
  test("12 questions, 4 weighted categories, 2/1/0 points, unanswered counts as worst", () => {
    assert.equal(QUESTIONS.length, 12);
    assert.equal(calculateScore(QUESTIONS.map(() => 0)).score, 100);
    assert.equal(calculateScore(QUESTIONS.map(() => 2)).score, 0);
    assert.equal(calculateScore([]).score, 0);
    // Access all best (30), the rest all middle (half of 70): 30 + 35 = 65.
    const mixed = calculateScore(QUESTIONS.map((q) => (q.cat === "access" ? 0 : 1)));
    assert.deepEqual(mixed, { score: 65, breakdown: { access: 100, physical: 50, data: 50, incident: 50 } });
  });

  test("under 40 says YOU DON'T HAVE A WISP; the fee comparison uses the firm's own fee", () => {
    assert.equal(scoreVerdict(39).headline, "YOU DON'T HAVE A WISP");
    assert.equal(scoreVerdict(40).headline, "YOUR WISP HAS SERIOUS GAPS");
    assert.equal(scoreVerdict(70).headline, "STRONG FOUNDATION");
    assert.equal(feeComparison({ per_return_fee: "250" }, null), null, "no firm fee set, no comparison");
    assert.equal(feeComparison({}, 223), null);
    assert.match(feeComparison({ per_return_fee: "250", volume: "150" }, 223)!.note, /save roughly \$4,050 per season/);
    assert.match(feeComparison({ per_return_fee: "$250" }, 223)!.note, /\$27 more per return/);
    const lower = feeComparison({ per_return_fee: "150", volume: "500" }, 223)!;
    assert.equal(lower.lower, true);
    assert.match(lower.note, /\$73 less per return than our all-in \$223/);
    assert.match(feeComparison({ per_return_fee: "223" }, 223)!.note, /same as our all-in/);
    assert.equal(comparisonFee({ comparison_fee: "$223" }), 223);
    assert.equal(comparisonFee({ delivery: "wisp_generator" }), null);
    assert.equal(comparisonFee(null), null);
  });

  test("number fields accept what people type", () => {
    assert.equal(numberInput(" 5 "), 5);
    assert.equal(numberInput("$1,250.50"), 1250.5);
    assert.equal(numberInput("five"), null);
    assert.equal(numberDraft("5 people", false), "5");
    assert.equal(numberDraft("$1,250.555", true), "1250.55");
    assert.equal(checkAudit([], { per_return_fee: "$150", volume: "1,500", bureau: "" }).ero.per_return_fee, "150");
    assert.equal(checkAudit([], { volume: "1,500" }).ero.volume, "1500");
    assert.equal(checkAudit([], { bureau: "" }).ero.bureau, undefined, "an unanswered question stays unanswered");
  });

  test("answers are checked again on the server", () => {
    assert.throws(() => checkAnswers({ ...ANSWERS, firm_name: " " }), /Firm \/ Business Name/);
    assert.throws(() => checkAnswers({ ...ANSWERS, mfa_status: "Sort of" }), /Choose an option/);
    assert.throws(() => checkAnswers({ ...ANSWERS, num_users: "three" }), /whole number/);
    const clean = checkAnswers({ ...ANSWERS, injected: "<script>", ein: "" });
    assert.equal("injected" in clean, false);
    assert.equal("ein" in clean, false, "the optional EIN can be left out");
    const { answers, ero } = checkAudit([0, 1, 2, 7, "x"], { is_ero: "Yes — I am an ERO", per_return_fee: "abc", volume: "150" });
    assert.deepEqual(answers.slice(0, 5), [0, 1, 2, null, null]);
    assert.deepEqual(ero, { is_ero: "Yes — I am an ERO", volume: "150" });
  });
});

describe("leads and plans", () => {
  test("every finished audit is kept as a lead, scored on the server", async () => {
    const s = setup();
    const r = await recordAudit(s.deps, { answers: QUESTIONS.map(() => 2), ero: { bureau: "Yes" } }, { ipHash: "abc", userAgent: "test" });
    assert.equal(r.score, 0);
    assert.equal(s.repo.audits[0].ero_answers.bureau, "Yes");
  });

  test("the builder's answers are sealed; only the buying browser's secret opens the plan", async () => {
    const s = setup();
    const { plan, accessToken } = await startPlan(s.deps, { answers: ANSWERS, email: "Anh@Example.com" });
    assert.equal(plan.email, "anh@example.com");
    assert.equal(plan.status, "draft");
    assert.doesNotMatch(plan.answers_sealed, /12-3456789|TaxSlayer/, "no answer is stored readable");
    assert.ok(await planForBuyer(s.deps, plan.id, accessToken));
    assert.equal(await planForBuyer(s.deps, plan.id, "wrong"), null);
    await assert.rejects(startPlan(s.deps, { answers: ANSWERS, email: "not-an-email" }), /valid email/);
  });
});

describe("after payment", () => {
  async function paid(s: ReturnType<typeof setup>) {
    const { plan, accessToken } = await startPlan(s.deps, { answers: ANSWERS, email: "anh@example.com" });
    await s.repo.updatePlan(plan.id, { stripe_session_id: "cs_wisp_1" });
    const after = await fulfilPaidPlan(s.deps, { sessionId: "cs_wisp_1", planId: plan.id, customerId: "cust-1", orderId: "order-1" });
    return { plan: after!, accessToken };
  }

  test("the PDF is made, filed in the tenant's folder, and emailed with the file attached and a year-long link", async () => {
    const s = setup();
    const { plan } = await paid(s);
    assert.equal(plan.status, "generated");
    assert.equal(plan.customer_id, "cust-1");
    assert.equal(plan.order_id, "order-1");
    assert.equal(plan.pdf_path, `${TENANT}/wisp/${plan.id}.pdf`);
    const pdf = await PDFDocument.load(s.store.objects.get(plan.pdf_path!)!.bytes);
    assert.match(pdf.getTitle() ?? "", /Ánh Tax Services LLC/);
    assert.equal(s.sent.length, 1);
    assert.equal(s.sent[0].to, "anh@example.com");
    assert.equal(s.sent[0].attachments[0].filename, "WISP-Anh-Tax-Services-LLC.pdf");
    assert.match(s.sent[0].text, /https:\/\/app\.monarchtaxsuite\.test\/wisp\/d\/[A-Za-z0-9_-]{43}/);
    assert.match(s.sent[0].text, /not attorney-approved/);
    assert.ok(plan.emailed_at);
    assert.deepEqual(s.repo.deliveries.map((d) => [d.kind, d.status, d.actor]), [["email", "sent", "system"]]);
  });

  test("Stripe retrying the webhook doesn't make or send it twice; a different checkout finds nothing", async () => {
    const s = setup();
    const { plan } = await paid(s);
    await fulfilPaidPlan(s.deps, { sessionId: "cs_wisp_1", planId: plan.id, customerId: "cust-1", orderId: "order-1" });
    assert.equal(s.sent.length, 1);
    assert.equal(await fulfilPaidPlan(s.deps, { sessionId: "cs_other", planId: plan.id, customerId: "cust-1", orderId: "order-2" }), null, "a plan is only paid by its own checkout");
  });

  test("a paid plan converts the lead who took its audit; a failure there never stops delivery", async () => {
    const s = setup();
    const leads = new MemoryLeads();
    const audit = await recordAudit(s.deps, { answers: QUESTIONS.map(() => 1), ero: {} }, { ipHash: null, userAgent: null });
    await captureAuditLead({ repo: leads }, { name: "Ánh", email: "anh@example.com" }, { id: audit.auditId, score: audit.score });
    s.deps.onPaid = (plan) => convertFromPurchase({ repo: leads }, { auditId: plan.audit_id, email: plan.email, planId: plan.id, customerId: plan.customer_id!, orderId: plan.order_id! });
    const { plan } = await startPlan(s.deps, { answers: ANSWERS, email: "office@example.com", auditId: audit.auditId });
    await s.repo.updatePlan(plan.id, { stripe_session_id: "cs_wisp_1" });
    await fulfilPaidPlan(s.deps, { sessionId: "cs_wisp_1", planId: plan.id, customerId: "cust-1", orderId: "order-1" });
    assert.deepEqual([leads.leads[0].status, leads.leads[0].order_id, leads.leads[0].wisp_plan_id], ["converted", "order-1", plan.id]);

    const t = setup();
    t.deps.onPaid = async () => { throw new Error("leads table missing"); };
    const p2 = await startPlan(t.deps, { answers: ANSWERS, email: "anh@example.com" });
    await t.repo.updatePlan(p2.plan.id, { stripe_session_id: "cs_wisp_2" });
    const delivered = await fulfilPaidPlan(t.deps, { sessionId: "cs_wisp_2", planId: p2.plan.id, customerId: "cust-1", orderId: "order-2" });
    assert.ok(delivered?.emailed_at);
  });

  test("a failed email is logged, shown, and can be retried (not twice in two minutes)", async () => {
    let fail = true;
    const s = setup({ mail: async () => (fail ? "The email provider is busy or unavailable (503)." : null) });
    const { plan } = await paid(s);
    assert.equal(plan.emailed_at, null);
    assert.match(plan.email_error!, /503/);
    assert.equal(s.repo.deliveries[0].status, "failed");
    fail = false;
    await assert.rejects(resendForBuyer(s.deps, plan), /wait two minutes/);
    s.advance(121);
    const after = await resendForBuyer(s.deps, plan);
    assert.ok(after.emailed_at);
    assert.equal(after.email_error, null);
    assert.deepEqual(s.repo.deliveries.map((d) => [d.status, d.actor]), [["sent", "buyer"], ["failed", "system"]]);
  });

  test("on Preview, held-back emails are logged as held back, not as sent", async () => {
    const s = setup({ mail: async (m) => `Not sent: this Preview deployment only emails addresses listed in AUTOMATION_TEST_RECIPIENTS, and ${m.to} isn't one of them.` });
    const { plan } = await paid(s);
    assert.equal(plan.emailed_at, null);
    assert.equal(s.repo.deliveries[0].status, "held_back");
  });

  test("downloads: the emailed link works for a year, each download is logged, and nothing outside the tenant's folder", async () => {
    const s = setup();
    const { plan } = await paid(s);
    const token = /\/wisp\/d\/([A-Za-z0-9_-]+)/.exec(s.sent[0].text)![1];
    const byLink = (await planForLink(s.deps, token))!;
    assert.equal(byLink.id, plan.id);
    assert.match(await downloadUrl(s.deps, byLink, "buyer"), /signed\//);
    assert.equal(s.repo.deliveries[0].status, "downloaded");
    s.advance((LINK_DAYS + 1) * 86_400);
    assert.equal(await planForLink(s.deps, token), null, "expired after a year");
    await s.repo.updatePlan(plan.id, { pdf_path: `00000000-0000-4000-8000-0000000000b2/wisp/${plan.id}.pdf` });
    await assert.rejects(downloadUrl(s.deps, (await s.repo.getPlan(plan.id))!, "buyer"), /Refused/);
  });

  test("unpaid plans can't be downloaded or sent", async () => {
    const s = setup();
    const { plan } = await startPlan(s.deps, { answers: ANSWERS, email: "anh@example.com" });
    await assert.rejects(downloadUrl(s.deps, plan, "buyer"), /hasn't been paid/);
    await assert.rejects(resendForBuyer(s.deps, plan), /hasn't been paid/);
  });
});

describe("the WISP product in the store", () => {
  const WISP: NewProduct = {
    slug: "wisp-assisted-build", name: "WISP Assisted Build", description: "Guided Written Information Security Plan.", product_type: "digital_download", access_type: "instant_download",
    installation_options: [], price_cents: 2500, currency: "usd", stripe_product_id: "prod_TESTWISP", stripe_price_id: null, status: "draft", metadata: { delivery: "wisp_generator" },
  };

  test("is the one digital download that can be sold, and only set up as an instant download", () => {
    const ready = { ...WISP, stripe_price_id: "price_1", stripe_price_cents: 2500, payment_type: "one_time" as const, category: null };
    assert.deepEqual(publishBlockers(ready as never, 1), []);
    assert.match(publishBlockers({ ...ready, access_type: "license", installation_options: ["self_service"] } as never, 1).join(" "), /instant-download access/);
    assert.match(publishBlockers({ ...ready, metadata: {} } as never, 1).join(" "), /Digital downloads cannot be sold/);
  });

  test("a paid WISP order from the verified webhook hands the session to WISP delivery, once", async () => {
    const commerce = new MemoryRepo();
    const product = await published(commerce, await createProduct(commerce, WISP));
    await seedCheckout(commerce, "cs_wisp_9", product.id, 2500);
    const calls: unknown[] = [];
    const fulfil: FulfillmentDeps = { repo: commerce, listCheckoutProductIds: async () => ["prod_TESTWISP"], wisp: async (i) => { calls.push(i); } };
    const evt = { id: "evt_w", type: "checkout.session.completed", data: { object: { id: "cs_wisp_9", payment_status: "paid", payment_intent: "pi_w", amount_total: 2500, currency: "usd", customer_details: { email: "anh@example.com", name: "Anh" }, metadata: { wisp_plan_id: "plan-9" } } } };
    await handleStripeEvent(fulfil, evt);
    await handleStripeEvent(fulfil, evt);
    assert.equal(calls.length, 1);
    assert.deepEqual(Object.keys(calls[0] as object).sort(), ["customerId", "orderId", "planId", "sessionId"]);
    assert.equal((calls[0] as { planId: string }).planId, "plan-9");
    assert.equal(commerce.licenses.length, 0, "no license for a WISP");
  });
});
