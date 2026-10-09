import { generateLicenseKey, hashLicenseKey, licenseKeyPrefix } from "./license-keys.ts";
import { normalizeDomain, normalizeEmail, ValidationError } from "./validation.ts";
import {
  INSTALLATION_TYPES,
  type CommerceRepo,
  type Customer,
  type Installation,
  type InstallationStatus,
  type InstallationType,
  type License,
  type LicenseStatus,
  type Order,
  type PaymentStatus,
  type Platform,
  type Product,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Stripe event shapes (only the fields we read). Events reach this module only
// after the webhook route has verified the Stripe signature.
// ---------------------------------------------------------------------------

type CheckoutSession = {
  id: string;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  payment_intent: string | { id: string } | null;
  amount_total: number | null;
  currency: string | null;
  customer: string | { id: string } | null;
  customer_details: { email: string | null; name: string | null } | null;
  metadata: Record<string, string> | null;
};
type PaymentIntent = { id: string };
type Charge = { payment_intent: string | { id: string } | null; amount: number; amount_refunded: number };
type Dispute = { payment_intent: string | { id: string } | null };

export type StripeEventLike = { id: string; type: string; data: { object: unknown } };

export type FulfillmentDeps = {
  repo: CommerceRepo;
  /** Stripe product ids of a checkout session's line items (Stripe API call in production). */
  listCheckoutProductIds(sessionId: string): Promise<string[]>;
  now?: () => string;
};

export type EventOutcome = { status: "processed" | "ignored" | "duplicate"; detail: string };

const idOf = (value: string | { id: string } | null | undefined) => (typeof value === "string" ? value : value?.id ?? null);
const nowIso = (deps: { now?: () => string }) => (deps.now ? deps.now() : new Date().toISOString());

function installationTypeFrom(metadata: Record<string, string> | null, product: Product): InstallationType {
  const requested = metadata?.installation_type;
  if (requested && (INSTALLATION_TYPES as readonly string[]).includes(requested) && product.installation_options.includes(requested as InstallationType)) {
    return requested as InstallationType;
  }
  return product.installation_options.includes("self_service") ? "self_service" : product.installation_options[0] ?? "self_service";
}

async function findOrCreateCustomer(repo: CommerceRepo, email: string, fullName: string | null, stripeCustomerId: string | null): Promise<Customer> {
  const existing = await repo.findCustomerByEmail(email);
  if (existing) {
    const patch: Partial<Customer> = {};
    if (!existing.full_name && fullName) patch.full_name = fullName;
    if (!existing.stripe_customer_id && stripeCustomerId) patch.stripe_customer_id = stripeCustomerId;
    return Object.keys(patch).length ? repo.updateCustomer(existing.id, patch) : existing;
  }
  return repo.createCustomer({ email, full_name: fullName, stripe_customer_id: stripeCustomerId });
}

/**
 * Creates the pending license and the installation request for a paid order.
 * Safe to call repeatedly: both records are unique per order.
 */
export async function ensureFulfillment(repo: CommerceRepo, order: Order, product: Product, actorId: string | null, details?: { platform?: Platform | null; target_location?: string | null }) {
  if (order.payment_status !== "paid") throw new ValidationError("Only paid orders can be fulfilled.");
  let license: License | null = null;
  if (product.access_type === "license") {
    const result = await repo.createLicense({
      customer_id: order.customer_id,
      order_id: order.id,
      product_id: product.id,
      key_hash: null,
      key_prefix: null,
      status: "pending",
      max_domains: 1,
      issued_at: null,
      activated_at: null,
      revoked_at: null,
      revoke_reason: null,
    });
    license = result.license;
    if (result.created) await repo.addLicenseEvent({ license_id: license.id, event_type: "created", detail: { order_id: order.id }, actor_id: actorId });
  }
  let installation: Installation | null = null;
  if (product.installation_options.length > 0) {
    const result = await repo.createInstallation({
      customer_id: order.customer_id,
      order_id: order.id,
      license_id: license?.id ?? null,
      product_id: product.id,
      installation_type: order.installation_type,
      platform: details?.platform ?? null,
      target_location: details?.target_location ?? null,
      status: "requested",
      internal_notes: null,
    });
    installation = result.installation;
    if (result.created) await repo.addInstallationEvent({ installation_id: installation.id, from_status: null, to_status: "requested", note: "Created from verified order.", actor_id: actorId });
  }
  return { license, installation };
}

async function setOrderPayment(repo: CommerceRepo, order: Order, status: PaymentStatus, at: string, extra: Partial<Order> = {}) {
  const patch: Partial<Order> = { payment_status: status, ...extra };
  if (status === "paid" && !order.paid_at) patch.paid_at = at;
  if (status === "refunded" && !order.refunded_at) patch.refunded_at = at;
  return repo.updateOrder(order.id, patch);
}

async function restrictLicenseForOrder(repo: CommerceRepo, order: Order, status: "suspended" | "revoked", reason: string, at: string) {
  const license = await repo.findLicenseByOrder(order.id);
  if (!license || license.status === "revoked" || license.status === status) return;
  await repo.updateLicense(license.id, status === "revoked" ? { status, revoked_at: at, revoke_reason: reason } : { status });
  await repo.addLicenseEvent({ license_id: license.id, event_type: status, detail: { reason }, actor_id: null });
  const installation = await repo.findInstallationByOrder(order.id);
  if (installation) await repo.addInstallationEvent({ installation_id: installation.id, from_status: installation.status, to_status: installation.status, note: `License ${status}: ${reason}`, actor_id: null });
}

async function handleCheckoutSession(deps: FulfillmentDeps, session: CheckoutSession, paid: boolean): Promise<EventOutcome> {
  const { repo } = deps;
  const at = nowIso(deps);
  const productIds = await deps.listCheckoutProductIds(session.id);
  let product: Product | null = null;
  for (const pid of productIds) {
    product = await repo.getProductByStripeProductId(pid);
    if (product) break;
  }
  if (!product) return { status: "ignored", detail: "No catalog product matches this checkout." };

  const paymentIntentId = idOf(session.payment_intent);
  if (!paymentIntentId) return { status: "ignored", detail: "Checkout has no payment intent (not a one-time payment)." };
  const rawEmail = session.customer_details?.email;
  if (!rawEmail) throw new Error(`Checkout ${session.id} has no customer email.`);

  const customer = await findOrCreateCustomer(repo, normalizeEmail(rawEmail), session.customer_details?.name?.trim() || null, idOf(session.customer));
  const { order } = await repo.createOrder({
    customer_id: customer.id,
    product_id: product.id,
    amount_cents: session.amount_total ?? 0,
    amount_refunded_cents: 0,
    currency: (session.currency ?? product.currency).toLowerCase(),
    payment_status: paid ? "paid" : "pending",
    provider: "stripe",
    provider_payment_intent_id: paymentIntentId,
    provider_checkout_session_id: session.id,
    installation_type: installationTypeFrom(session.metadata, product),
    verification_method: "stripe_webhook",
    verified_by: null,
    verified_at: at,
    notes: null,
    paid_at: paid ? at : null,
    refunded_at: null,
  });
  if (order.customer_id !== customer.id) throw new Error(`Payment intent ${paymentIntentId} is already attached to a different customer.`);

  let current = order;
  if (paid && current.payment_status === "pending") current = await setOrderPayment(repo, current, "paid", at);
  if (current.payment_status === "paid") await ensureFulfillment(repo, current, product, null);
  return { status: "processed", detail: `Order ${current.id} is ${current.payment_status}.` };
}

/** Applies one signature-verified Stripe event. Idempotent per event id and per payment intent. */
export async function handleStripeEvent(deps: FulfillmentDeps, event: StripeEventLike): Promise<EventOutcome> {
  const { repo } = deps;
  if ((await repo.claimStripeEvent(event.id, event.type)) === "duplicate") {
    return { status: "duplicate", detail: "Event already processed." };
  }
  try {
    const outcome = await applyEvent(deps, event);
    await repo.finishStripeEvent(event.id, outcome.status === "ignored" ? "ignored" : "processed");
    return outcome;
  } catch (error) {
    // Recorded as failed so Stripe's retry is processed again.
    await repo.finishStripeEvent(event.id, "failed", error instanceof Error ? error.message.slice(0, 500) : "Unknown error");
    throw error;
  }
}

async function applyEvent(deps: FulfillmentDeps, event: StripeEventLike): Promise<EventOutcome> {
  const { repo } = deps;
  const at = nowIso(deps);
  const object = event.data.object;
  switch (event.type) {
    case "checkout.session.completed": {
      const session = object as CheckoutSession;
      return handleCheckoutSession(deps, session, session.payment_status === "paid");
    }
    case "checkout.session.async_payment_succeeded":
      return handleCheckoutSession(deps, object as CheckoutSession, true);
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const pi = idOf((object as CheckoutSession).payment_intent);
      const order = pi ? await repo.findOrderByPaymentIntent(pi) : null;
      if (!order) return { status: "ignored", detail: "No order for this checkout." };
      if (order.payment_status === "pending") {
        await setOrderPayment(repo, order, event.type === "checkout.session.expired" ? "canceled" : "failed", at);
      }
      return { status: "processed", detail: `Order ${order.id} not paid.` };
    }
    case "payment_intent.succeeded": {
      const order = await repo.findOrderByPaymentIntent((object as PaymentIntent).id);
      if (!order) return { status: "ignored", detail: "No order yet; checkout.session.completed creates it." };
      if (order.payment_status === "pending") {
        const paidOrder = await setOrderPayment(repo, order, "paid", at);
        const product = await repo.getProduct(paidOrder.product_id);
        if (product) await ensureFulfillment(repo, paidOrder, product, null);
      }
      return { status: "processed", detail: `Order ${order.id} paid.` };
    }
    case "payment_intent.payment_failed":
    case "payment_intent.canceled": {
      const order = await repo.findOrderByPaymentIntent((object as PaymentIntent).id);
      if (!order) return { status: "ignored", detail: "No order for this payment." };
      if (order.payment_status === "pending") {
        await setOrderPayment(repo, order, event.type === "payment_intent.canceled" ? "canceled" : "failed", at);
      }
      return { status: "processed", detail: `Order ${order.id} not paid.` };
    }
    case "charge.refunded": {
      const charge = object as Charge;
      const pi = idOf(charge.payment_intent);
      const order = pi ? await repo.findOrderByPaymentIntent(pi) : null;
      if (!order) return { status: "ignored", detail: "No order for this charge." };
      const full = charge.amount_refunded >= charge.amount;
      await setOrderPayment(repo, order, full ? "refunded" : "partially_refunded", at, { amount_refunded_cents: charge.amount_refunded });
      if (full) await restrictLicenseForOrder(repo, order, "revoked", "Payment refunded", at);
      return { status: "processed", detail: `Order ${order.id} ${full ? "refunded" : "partially refunded"}.` };
    }
    case "charge.dispute.created": {
      const pi = idOf((object as Dispute).payment_intent);
      const order = pi ? await repo.findOrderByPaymentIntent(pi) : null;
      if (!order) return { status: "ignored", detail: "No order for this dispute." };
      await setOrderPayment(repo, order, "disputed", at);
      await restrictLicenseForOrder(repo, order, "suspended", "Payment disputed", at);
      return { status: "processed", detail: `Order ${order.id} disputed.` };
    }
    default:
      return { status: "ignored", detail: `Unhandled event type ${event.type}.` };
  }
}

// ---------------------------------------------------------------------------
// Manual reconciliation for purchases made before the webhook existed.
// ---------------------------------------------------------------------------

export type StripePaymentCheck = {
  status: string;
  amount_received: number;
  currency: string;
  email: string | null;
};

export type ReconcileInput = {
  email: string;
  full_name: string | null;
  payment_intent_id: string;
  amount_cents: number;
  currency: string;
  product_id: string;
  installation_type: InstallationType;
  platform: Platform | null;
  target_location: string | null;
  notes: string | null;
  admin_id: string;
  /** Live Stripe lookup when a secret key is configured. */
  stripe_payment: StripePaymentCheck | null;
  /** Administrator attests they verified the payment in the Stripe dashboard. */
  admin_attested: boolean;
};

export async function reconcilePurchase(repo: CommerceRepo, input: ReconcileInput, now?: () => string) {
  const at = now ? now() : new Date().toISOString();
  if (!/^pi_[A-Za-z0-9]{8,}$/.test(input.payment_intent_id)) throw new ValidationError("Enter a Stripe payment intent ID (pi_…).");
  if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) throw new ValidationError("Enter the paid amount.");
  const email = normalizeEmail(input.email);
  const product = await repo.getProduct(input.product_id);
  if (!product) throw new ValidationError("Choose a catalog product.");
  if (!product.installation_options.includes(input.installation_type)) throw new ValidationError("That installation option is not offered for this product.");

  const check = input.stripe_payment;
  if (check) {
    if (check.status !== "succeeded") throw new ValidationError(`Stripe reports this payment as "${check.status}", not succeeded.`);
    if (check.amount_received !== input.amount_cents || check.currency.toLowerCase() !== input.currency.toLowerCase()) {
      throw new ValidationError("Amount or currency does not match the Stripe payment.");
    }
    if (check.email && check.email.toLowerCase() !== email) throw new ValidationError("The customer email does not match the Stripe payment.");
  } else if (!input.admin_attested) {
    throw new ValidationError("Confirm that you verified this payment in Stripe before reconciling.");
  }

  const existing = await repo.findOrderByPaymentIntent(input.payment_intent_id);
  if (existing) {
    const owner = await repo.getCustomer(existing.customer_id);
    if (owner?.email !== email) throw new ValidationError("This payment is already recorded for a different customer.");
  }

  const customer = await findOrCreateCustomer(repo, email, input.full_name, null);
  const { order, created } = await repo.createOrder({
    customer_id: customer.id,
    product_id: product.id,
    amount_cents: input.amount_cents,
    amount_refunded_cents: 0,
    currency: input.currency.toLowerCase(),
    payment_status: "paid",
    provider: "stripe",
    provider_payment_intent_id: input.payment_intent_id,
    provider_checkout_session_id: null,
    installation_type: input.installation_type,
    verification_method: check ? "stripe_api" : "admin_manual",
    verified_by: input.admin_id,
    verified_at: at,
    notes: input.notes,
    paid_at: at,
    refunded_at: null,
  });
  if (order.payment_status !== "paid") throw new ValidationError(`This order is ${order.payment_status}; it cannot be fulfilled.`);
  const fulfillment = await ensureFulfillment(repo, order, product, input.admin_id, { platform: input.platform, target_location: input.target_location });
  return { customer, order, created, ...fulfillment };
}

// ---------------------------------------------------------------------------
// Administrator license and installation actions.
// ---------------------------------------------------------------------------

/** Issues (or rotates) a license key. The plaintext key is returned once and never stored. */
export async function issueLicenseKey(repo: CommerceRepo, licenseId: string, actorId: string, now?: () => string) {
  const license = await repo.getLicense(licenseId);
  if (!license) throw new ValidationError("License not found.");
  if (license.status === "revoked") throw new ValidationError("Revoked licenses cannot receive a key.");
  const order = await repo.getOrder(license.order_id);
  if (order?.payment_status !== "paid") throw new ValidationError("The order is not paid; a key cannot be issued.");
  const key = generateLicenseKey();
  const rotating = Boolean(license.key_hash);
  const updated = await repo.updateLicense(license.id, {
    key_hash: hashLicenseKey(key),
    key_prefix: licenseKeyPrefix(key),
    status: license.status === "pending" ? "active" : license.status,
    issued_at: now ? now() : new Date().toISOString(),
  });
  await repo.addLicenseEvent({ license_id: license.id, event_type: rotating ? "key_rotated" : "key_issued", detail: { key_prefix: updated.key_prefix }, actor_id: actorId });
  return { key, license: updated };
}

export async function setLicenseStatus(repo: CommerceRepo, licenseId: string, status: Exclude<LicenseStatus, "pending">, reason: string | null, actorId: string, now?: () => string) {
  const license = await repo.getLicense(licenseId);
  if (!license) throw new ValidationError("License not found.");
  if (license.status === "revoked") throw new ValidationError("Revoked licenses cannot be changed.");
  if (status === "active") {
    if (!license.key_hash) throw new ValidationError("Issue a license key before activating.");
    const order = await repo.getOrder(license.order_id);
    if (order?.payment_status !== "paid") throw new ValidationError("The order is not paid.");
  }
  if (status === "revoked" && !reason) throw new ValidationError("Give a reason for revoking.");
  const at = now ? now() : new Date().toISOString();
  const updated = await repo.updateLicense(license.id, status === "revoked" ? { status, revoked_at: at, revoke_reason: reason } : { status });
  await repo.addLicenseEvent({ license_id: license.id, event_type: status, detail: reason ? { reason } : {}, actor_id: actorId });
  return updated;
}

export async function authorizeDomain(repo: CommerceRepo, licenseId: string, rawDomain: string, actorId: string, now?: () => string) {
  const license = await repo.getLicense(licenseId);
  if (!license) throw new ValidationError("License not found.");
  if (license.status !== "active") throw new ValidationError("Only active licenses can authorize domains.");
  const domain = normalizeDomain(rawDomain);
  const domains = await repo.listDomains(license.id);
  const active = domains.filter((d) => d.status === "active");
  if (active.some((d) => d.domain === domain)) return active.find((d) => d.domain === domain)!;
  if (active.length >= license.max_domains) throw new ValidationError(`This license allows ${license.max_domains} domain(s). Remove one first.`);
  const record = await repo.upsertDomain(license.id, domain, "active");
  if (!license.activated_at) await repo.updateLicense(license.id, { activated_at: now ? now() : new Date().toISOString() });
  await repo.addLicenseEvent({ license_id: license.id, event_type: "domain_authorized", detail: { domain }, actor_id: actorId });
  return record;
}

export async function removeDomain(repo: CommerceRepo, licenseId: string, domain: string, actorId: string) {
  const record = await repo.upsertDomain(licenseId, normalizeDomain(domain), "removed");
  await repo.addLicenseEvent({ license_id: licenseId, event_type: "domain_removed", detail: { domain: record.domain }, actor_id: actorId });
  return record;
}

export type InstallationUpdate = {
  status?: InstallationStatus;
  installation_type?: InstallationType;
  platform?: Platform | null;
  target_location?: string | null;
  internal_notes?: string | null;
  note?: string | null;
};

export async function updateInstallation(repo: CommerceRepo, installationId: string, update: InstallationUpdate, actorId: string) {
  const installation = await repo.getInstallation(installationId);
  if (!installation) throw new ValidationError("Installation not found.");
  if (update.status === "active") {
    const license = installation.license_id ? await repo.getLicense(installation.license_id) : null;
    if (installation.license_id && license?.status !== "active") throw new ValidationError("Activate the license before marking the installation active.");
    const order = await repo.getOrder(installation.order_id);
    if (order?.payment_status !== "paid") throw new ValidationError("The order is not paid.");
  }
  const { note, ...fields } = update;
  const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<Installation>;
  const updated = Object.keys(patch).length ? await repo.updateInstallation(installation.id, patch) : installation;
  const statusChanged = update.status !== undefined && update.status !== installation.status;
  if (statusChanged || note) {
    await repo.addInstallationEvent({
      installation_id: installation.id,
      from_status: statusChanged ? installation.status : null,
      to_status: statusChanged ? update.status! : null,
      note: note ?? null,
      actor_id: actorId,
    });
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Dashboard metrics, derived only from stored records.
// ---------------------------------------------------------------------------

export function computeMetrics(data: { customers: Customer[]; orders: Order[]; products: Product[]; licenses: License[]; installations: Installation[] }) {
  const settled = data.orders.filter((o) => o.payment_status === "paid" || o.payment_status === "partially_refunded" || o.payment_status === "refunded");
  const revenueByCurrency: Record<string, number> = {};
  for (const o of settled) revenueByCurrency[o.currency] = (revenueByCurrency[o.currency] ?? 0) + o.amount_cents - o.amount_refunded_cents;
  return {
    customers: data.customers.length,
    paidOrders: data.orders.filter((o) => o.payment_status === "paid" || o.payment_status === "partially_refunded").length,
    revenueByCurrency,
    publishedProducts: data.products.filter((p) => p.status === "published").length,
    activeLicenses: data.licenses.filter((l) => l.status === "active").length,
    pendingLicenses: data.licenses.filter((l) => l.status === "pending").length,
    openInstallations: data.installations.filter((i) => i.status === "requested" || i.status === "in_progress" || i.status === "blocked").length,
  };
}
