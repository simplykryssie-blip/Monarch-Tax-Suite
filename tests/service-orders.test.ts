import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MemoryRepo, makeSellable, seedCheckout } from "./memory-repo.ts";
import { MemoryAutomationRepo } from "./automation-memory.ts";
import { createProduct, editProduct, setProductStatus } from "../lib/commerce/catalog.ts";
import { handleStripeEvent, type FulfillmentDeps } from "../lib/commerce/fulfillment.ts";
import { serviceNextStep, updateServiceOrder, type NewServiceOrder, type ServiceOrder, type ServiceOrderEvent, type ServiceOrdersRepo } from "../lib/commerce/service-orders.ts";
import { emitEvent, type AutomationDeps } from "../lib/automation/engine.ts";
import { installDefaults } from "../lib/automation/defaults.ts";
import type { EmailMessage, EmailSender, SendResult } from "../lib/automation/email.ts";
import { MONARCH_TENANT_ID } from "../lib/tenants.ts";
import type { NewProduct } from "../lib/commerce/types.ts";

// Phase 1 step F3c: a paid service creates one tracked service order (decisions E2 and E4).

class MemoryServices implements ServiceOrdersRepo {
  orders: ServiceOrder[] = [];
  events: ServiceOrderEvent[] = [];
  async createServiceOrder(input: NewServiceOrder) {
    const existing = this.orders.find((o) => o.order_id === input.order_id);
    if (existing) return { serviceOrder: { ...existing }, created: false };
    const now = new Date().toISOString();
    const so: ServiceOrder = { ...input, id: randomUUID(), status: "new", delivered_at: null, canceled_at: null, created_at: now, updated_at: now };
    this.orders.push(so);
    return { serviceOrder: { ...so }, created: true };
  }
  async getServiceOrder(id: string) { const so = this.orders.find((o) => o.id === id); return so ? { ...so } : null; }
  async findServiceOrderByOrder(orderId: string) { const so = this.orders.find((o) => o.order_id === orderId); return so ? { ...so } : null; }
  async updateServiceOrder(id: string, patch: Partial<ServiceOrder>) { const so = this.orders.find((o) => o.id === id)!; Object.assign(so, patch); return { ...so }; }
  async listServiceOrders(tenantId: string) { return this.orders.filter((o) => o.tenant_id === tenantId); }
  async addServiceOrderEvent(input: Omit<ServiceOrderEvent, "id" | "created_at">) { this.events.push({ ...input, id: randomUUID(), created_at: new Date().toISOString() }); }
  async listServiceOrderEvents(id: string) { return this.events.filter((e) => e.service_order_id === id); }
}

class FakeEmail implements EmailSender {
  sent: EmailMessage[] = [];
  async send(m: EmailMessage): Promise<SendResult> { this.sent.push(m); return { ok: true, id: `msg_${this.sent.length}` }; }
}

const SERVICE: NewProduct = {
  slug: "bureau-setup-review", name: "Bureau Setup Review", description: "A review of your service bureau setup.", product_type: "service", access_type: "manual",
  installation_options: [], price_cents: 25000, currency: "usd", stripe_product_id: "prod_SERVICE001", stripe_price_id: "price_SERVICE001", status: "draft",
  metadata: { service_deliverable: "A written review of your bureau setup with recommendations", service_owner: "Monarch support", service_response_time: "2 business days" },
};

async function shop() {
  const commerce = new MemoryRepo();
  const services = new MemoryServices();
  const product = await createProduct(commerce, SERVICE);
  await makeSellable(commerce, product.id);
  await setProductStatus(commerce, product.id, "published");
  const emitted: string[] = [];
  const deps: FulfillmentDeps = { repo: commerce, listCheckoutProductIds: async () => ["prod_SERVICE001"], services: { repo: services, tenantId: MONARCH_TENANT_ID }, emit: async (e) => void emitted.push(e.key) };
  const pay = async (n: number, extra: Record<string, unknown> = {}) => {
    if (!(await commerce.findStorefrontCheckout(`cs_svc${n}`))) await seedCheckout(commerce, `cs_svc${n}`, product.id, 25000);
    return handleStripeEvent(deps, {
      id: `evt_svc${n}_${randomUUID().slice(0, 6)}`, type: "checkout.session.completed",
      data: { object: { id: `cs_svc${n}`, payment_status: "paid", payment_intent: `pi_SERVICE0000${n}`, amount_total: 25000, currency: "usd", customer: null, customer_details: { email: `s${n}@example.com`, name: "Sam Service" }, metadata: {}, ...extra } },
    });
  };
  return { commerce, services, product, deps, emitted, pay };
}

describe("a paid service creates one tracked service order", () => {
  test("snapshot of what was promised, tenant #1, a history entry and one automation event", async () => {
    const { services, pay, emitted, commerce } = await shop();
    await pay(1);
    await pay(1); // Stripe redelivery under a new event id
    assert.equal(services.orders.length, 1);
    const [so] = services.orders;
    assert.equal(so.tenant_id, MONARCH_TENANT_ID);
    assert.equal(so.status, "new");
    assert.equal(so.order_id, commerce.orders[0].id);
    assert.equal(so.deliverable, "A written review of your bureau setup with recommendations");
    assert.equal(so.owner, "Monarch support");
    assert.equal(so.response_time, "2 business days");
    assert.match(so.next_step ?? "", /Contact the customer/);
    assert.deepEqual(services.events.map((e) => [e.to_status, e.tenant_id]), [["new", MONARCH_TENANT_ID]]);
    assert.deepEqual(emitted, [`order:${so.order_id}:service_created`]);
    assert.equal(commerce.licenses.length, 0, "services get no license");
  });

  test("later product edits never rewrite an existing service order", async () => {
    const { services, pay, commerce, product } = await shop();
    await pay(1);
    await setProductStatus(commerce, product.id, "unpublished");
    await editProduct(commerce, product.id, { ...SERVICE, metadata: { ...SERVICE.metadata, service_response_time: "1 hour" } });
    assert.equal(services.orders[0].response_time, "2 business days");
  });

  test("an unpublished service or an unrecorded payment creates no service order", async () => {
    const { services, pay, commerce, product } = await shop();
    await setProductStatus(commerce, product.id, "unpublished");
    await pay(1);
    assert.equal(services.orders.length, 0);
    assert.match(commerce.orders[0].notes ?? "", /^Review:/);
  });

  test("a full refund or a dispute cancels an open service order; a delivered one is left as it is", async () => {
    const { services, pay, deps } = await shop();
    await pay(1);
    await pay(2);
    await updateServiceOrder(services, services.orders[1].id, { status: "delivered" }, "admin");
    await handleStripeEvent(deps, { id: "evt_r1", type: "charge.refunded", data: { object: { payment_intent: "pi_SERVICE00001", amount: 25000, amount_refunded: 25000 } } });
    await handleStripeEvent(deps, { id: "evt_d2", type: "charge.dispute.created", data: { object: { payment_intent: "pi_SERVICE00002" } } });
    assert.equal(services.orders[0].status, "canceled");
    assert.ok(services.orders[0].canceled_at);
    assert.equal(services.orders[1].status, "delivered");
  });
});

describe("working a service order", () => {
  test("status changes are checked, recorded, and delivering is reported once", async () => {
    const { services, pay } = await shop();
    await pay(1);
    const id = services.orders[0].id;
    const started = await updateServiceOrder(services, id, { status: "in_progress", nextStep: "Review the bureau documents." }, "admin");
    assert.equal(started.delivered, false);
    assert.equal(serviceNextStep(started.serviceOrder).text, "Monarch support: Review the bureau documents.");
    await assert.rejects(updateServiceOrder(services, id, { status: "waiting_on_customer", nextStep: "" }, "admin"), /what the customer needs to do/);
    const waiting = await updateServiceOrder(services, id, { status: "waiting_on_customer", nextStep: "Send your EFIN letter." }, "admin");
    assert.deepEqual(serviceNextStep(waiting.serviceOrder), { waitingOn: "customer", text: "Send your EFIN letter." });
    const done = await updateServiceOrder(services, id, { status: "delivered", note: "Review emailed." }, "admin");
    assert.equal(done.delivered, true);
    assert.ok(done.serviceOrder.delivered_at);
    assert.equal(done.serviceOrder.next_step, null);
    const reopened = await updateServiceOrder(services, id, { status: "in_progress", nextStep: "Fix the section the customer asked about." }, "admin");
    assert.equal(reopened.serviceOrder.delivered_at, null);
    await updateServiceOrder(services, id, { status: "canceled" }, "admin");
    await assert.rejects(updateServiceOrder(services, id, { status: "in_progress" }, "admin"), /canceled service order cannot become in progress/);
    await assert.rejects(updateServiceOrder(services, id, {}, "admin"), /Nothing to update/);
    assert.deepEqual(services.events.map((e) => e.to_status), ["new", "in_progress", "waiting_on_customer", "delivered", "in_progress", "canceled"]);
    assert.ok(services.events.every((e) => e.tenant_id === MONARCH_TENANT_ID));
  });

  test("a note alone is kept in the history", async () => {
    const { services, pay } = await shop();
    await pay(1);
    await updateServiceOrder(services, services.orders[0].id, { note: "Called the customer; left a voicemail." }, "admin");
    assert.equal(services.events.at(-1)!.note, "Called the customer; left a voicemail.");
    assert.equal(services.events.at(-1)!.to_status, null);
  });
});

describe("service emails", () => {
  test("the customer gets what, who and when; the team gets a new-order notice; delivery sends a completion notice", async () => {
    const { services, pay, commerce } = await shop();
    await pay(1);
    const repo = new MemoryAutomationRepo();
    const email = new FakeEmail();
    const auto: AutomationDeps = { repo, commerce, crm: null, services, email, config: { origin: () => "https://app.test", supportEmail: "support@monarchtaxsuite.com", supportRecipient: "team@monarch.test", env: "production", testRecipients: [] } };
    await installDefaults(repo, null);
    const so = services.orders[0];
    await emitEvent(auto, { type: "service.order_created", key: `order:${so.order_id}:service_created`, customerId: so.customer_id, orderId: so.order_id });
    assert.deepEqual(email.sent.map((m) => m.to), ["s1@example.com", "team@monarch.test"]);
    const [customer, team] = email.sent;
    assert.match(customer.subject, new RegExp(`order #${commerce.orders[0].order_number}: Bureau Setup Review`));
    assert.match(customer.text, /What you receive: A written review of your bureau setup with recommendations/);
    assert.match(customer.text, /Who is handling it: Monarch support/);
    assert.match(customer.text, /When to expect a response: 2 business days/);
    assert.match(customer.text, /Next step: Contact the customer/);
    assert.match(team.text, /Sam Service paid for Bureau Setup Review/);
    await updateServiceOrder(services, so.id, { status: "delivered" }, "admin");
    await emitEvent(auto, { type: "service.order_delivered", key: `service:${so.id}:delivered`, customerId: so.customer_id, orderId: so.order_id });
    assert.equal(email.sent.length, 3);
    assert.match(email.sent[2].subject, /Your Bureau Setup Review is complete/);
  });
});
