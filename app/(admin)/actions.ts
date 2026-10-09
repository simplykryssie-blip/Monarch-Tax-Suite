"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { appOrigin, commerceRepo, requireAdmin, stripeClient } from "@/lib/admin";
import { setProductStatus } from "@/lib/commerce/catalog.ts";
import {
  authorizeDomain,
  createIntakeLink,
  issueLicenseKey,
  reconcilePurchase,
  removeDomain,
  setLicenseStatus,
  updateInstallation,
  type StripePaymentCheck,
} from "@/lib/commerce/fulfillment.ts";
import { disconnect as disconnectCrm } from "@/lib/crm/connection.ts";
import { crmDeps } from "@/lib/crm/server";
import { publishBlockersForVersion } from "@/lib/commerce/stripe-verify.ts";
import { createVersion, editVersion, parseTaxYear, recordChange, setVersionStatus } from "@/lib/commerce/versions.ts";
import {
  cleanNote,
  normalizeDomain,
  normalizeEmail,
  normalizeWebsiteUrl,
  parseInstallationMethod,
  parseInstallationStatus,
  parseInstallationType,
  parsePlatform,
  parsePriceToCents,
  parseProductStatus,
  ValidationError,
} from "@/lib/commerce/validation.ts";

// Every action re-checks administrator access server-side; hiding buttons in
// the UI is not relied on for authorization.

const str = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(form: FormData, name = "id") {
  const value = str(form, name);
  if (!UUID.test(value)) throw new ValidationError("Invalid record reference.");
  return value;
}

function withParam(path: string, key: string, value: string) {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

/** Runs a mutation, then redirects back with a notice or a validation error. */
async function mutate(back: string, fn: () => Promise<{ to?: string; notice: string }>) {
  let target: string;
  try {
    const result = await fn();
    target = withParam(result.to ?? back, "notice", result.notice);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    target = withParam(back, "error", error.message);
  }
  revalidatePath("/", "layout");
  redirect(target);
}

// ----------------------------------------------------------------- products

export async function setProductStatusAction(form: FormData) {
  await requireAdmin();
  const productId = id(form);
  await mutate(`/products/${productId}`, async () => {
    const product = await setProductStatus(commerceRepo(), productId, parseProductStatus(str(form, "status")));
    return { notice: `Product is now ${product.status}.` };
  });
}

// ------------------------------------------------------------ reconciliation

async function lookupStripePayment(paymentIntentId: string): Promise<StripePaymentCheck | null> {
  const stripe = stripeClient();
  if (!stripe) return null;
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
    const charge = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    return { status: pi.status, amount_received: pi.amount_received, currency: pi.currency, email: pi.receipt_email ?? charge?.billing_details?.email ?? null };
  } catch {
    throw new ValidationError("Stripe could not find this payment intent with the configured key.");
  }
}

export async function reconcilePurchaseAction(form: FormData) {
  const admin = await requireAdmin();
  await mutate("/orders/reconcile", async () => {
    const paymentIntentId = str(form, "payment_intent_id");
    const legacyAccount = form.get("legacy_account") === "on";
    const amount = parsePriceToCents(str(form, "amount"));
    if (amount === null) throw new ValidationError("Enter the paid amount.");
    const result = await reconcilePurchase(commerceRepo(), {
      email: normalizeEmail(str(form, "email")),
      full_name: str(form, "full_name").slice(0, 120) || null,
      payment_intent_id: paymentIntentId,
      amount_cents: amount,
      currency: (str(form, "currency") || "usd").toLowerCase(),
      product_id: id(form, "product_id"),
      installation_type: parseInstallationType(str(form, "installation_type")),
      platform: parsePlatform(str(form, "platform")),
      platform_other: cleanNote(str(form, "platform_other"), 80),
      website_url: str(form, "website_url") ? normalizeWebsiteUrl(str(form, "website_url")) : null,
      target_location: str(form, "target_location") ? normalizeDomain(str(form, "target_location")) : null,
      notes: cleanNote(legacyAccount ? `Paid in a previous Stripe account (not Monarch's current account); verified manually by an administrator. ${str(form, "notes")}`.trim() : str(form, "notes")),
      admin_id: admin.userId,
      // A payment taken in a previous Stripe account cannot be looked up with Monarch's current key.
      stripe_payment: legacyAccount ? null : /^pi_/.test(paymentIntentId) ? await lookupStripePayment(paymentIntentId) : null,
      admin_attested: form.get("attest") === "on",
    });
    const target = result.installation ? `/installations/${result.installation.id}` : `/customers/${result.customer.id}`;
    return { to: target, notice: result.created ? "Purchase reconciled. Order, license and installation records created." : "This payment was already recorded; existing records shown." };
  });
}

// ----------------------------------------------------------------- licenses

export type IssueKeyState = { key?: string; error?: string };

/** Returns the plaintext key once; it is never stored or sent through a URL. */
export async function issueLicenseKeyAction(_prev: IssueKeyState, form: FormData): Promise<IssueKeyState> {
  const admin = await requireAdmin();
  try {
    const { key } = await issueLicenseKey(commerceRepo(), id(form), admin.userId);
    revalidatePath("/", "layout");
    return { key };
  } catch (error) {
    if (error instanceof ValidationError) return { error: error.message };
    throw error;
  }
}

export async function setLicenseStatusAction(form: FormData) {
  const admin = await requireAdmin();
  const licenseId = id(form);
  await mutate(`/licenses/${licenseId}`, async () => {
    const status = str(form, "status");
    if (status !== "active" && status !== "suspended" && status !== "revoked") throw new ValidationError("Invalid license status.");
    const license = await setLicenseStatus(commerceRepo(), licenseId, status, cleanNote(str(form, "reason"), 500), admin.userId);
    return { notice: `License is now ${license.status}.` };
  });
}

export async function authorizeDomainAction(form: FormData) {
  const admin = await requireAdmin();
  const licenseId = id(form);
  await mutate(`/licenses/${licenseId}`, async () => {
    const record = await authorizeDomain(commerceRepo(), licenseId, str(form, "domain"), admin.userId);
    return { notice: `${record.domain} authorized.` };
  });
}

export async function removeDomainAction(form: FormData) {
  const admin = await requireAdmin();
  const licenseId = id(form);
  await mutate(`/licenses/${licenseId}`, async () => {
    const record = await removeDomain(commerceRepo(), licenseId, str(form, "domain"), admin.userId);
    return { notice: `${record.domain} removed.` };
  });
}

// ------------------------------------------------------------ installations

export async function updateInstallationAction(form: FormData) {
  const admin = await requireAdmin();
  const installationId = id(form);
  await mutate(`/installations/${installationId}`, async () => {
    await updateInstallation(
      commerceRepo(),
      installationId,
      {
        status: parseInstallationStatus(str(form, "status")),
        installation_type: parseInstallationType(str(form, "installation_type")),
        platform: parsePlatform(str(form, "platform")),
        platform_other: cleanNote(str(form, "platform_other"), 80),
        installation_method: parseInstallationMethod(str(form, "installation_method")),
        website_url: str(form, "website_url") ? normalizeWebsiteUrl(str(form, "website_url")) : null,
        target_location: str(form, "target_location") ? normalizeDomain(str(form, "target_location")) : null,
        requirements: cleanNote(str(form, "requirements")),
        internal_notes: cleanNote(str(form, "internal_notes")),
        note: cleanNote(str(form, "note"), 1000),
      },
      admin.userId,
    );
    return { notice: "Installation updated." };
  });
}

export type IntakeLinkState = { url?: string; error?: string };

/** Creates a one-time customer link to collect platform, website and domain. Shown once. */
export async function createIntakeLinkAction(_prev: IntakeLinkState, form: FormData): Promise<IntakeLinkState> {
  const admin = await requireAdmin();
  try {
    const { token } = await createIntakeLink(commerceRepo(), id(form), admin.userId);
    revalidatePath("/", "layout");
    return { url: `${await appOrigin()}/install/${token}` };
  } catch (error) {
    if (error instanceof ValidationError) return { error: error.message };
    throw error;
  }
}

// ----------------------------------------------------------------- versions

function optionalDate(form: FormData, name: string): string | null {
  const v = str(form, name);
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ValidationError("Enter the release date as YYYY-MM-DD.");
  return v;
}

export async function createVersionAction(form: FormData) {
  await requireAdmin();
  const productId = id(form, "product_id");
  await mutate(`/products/${productId}`, async () => {
    const version = await createVersion(commerceRepo(), {
      product_id: productId,
      tax_year: parseTaxYear(str(form, "tax_year")),
      label: cleanNote(str(form, "label"), 80),
      release_date: optionalDate(form, "release_date"),
      update_price_cents: str(form, "update_price") ? parsePriceToCents(str(form, "update_price")) : null,
      stripe_update_price_id: null, // linked only through the verified Stripe price flow
    });
    return { notice: `${version.label} created as a draft. Next: Check Stripe price.` };
  });
}

export async function updateVersionAction(form: FormData) {
  await requireAdmin();
  const productId = id(form, "product_id");
  await mutate(`/products/${productId}`, async () => {
    const price = parsePriceToCents(str(form, "update_price"));
    if (price === null || price <= 0) throw new ValidationError("Enter the update price.");
    await editVersion(commerceRepo(), id(form), {
      label: cleanNote(str(form, "label"), 80) ?? undefined,
      release_date: optionalDate(form, "release_date"),
      update_price_cents: price,
    });
    return { notice: "Version saved." };
  });
}

export async function setVersionStatusAction(form: FormData) {
  const admin = await requireAdmin();
  const productId = id(form, "product_id");
  await mutate(`/products/${productId}`, async () => {
    const status = str(form, "status");
    if (status !== "available" && status !== "retired" && status !== "draft") throw new ValidationError("Invalid version status.");
    if (status === "available") {
      const current = await commerceRepo().getVersion(id(form));
      if (!current) throw new ValidationError("Version not found.");
      const blockers = publishBlockersForVersion(current);
      if (blockers.length && current.status !== "available") throw new ValidationError(`Not published: ${blockers.join(" ")}`);
      if (form.get("confirm") !== "on") throw new ValidationError("Confirm the verified price and version before publishing.");
    }
    const version = await setVersionStatus(commerceRepo(), id(form), status, admin.userId);
    return { notice: `${version.label} is now ${version.status}.` };
  });
}

export async function recordVersionChangeAction(form: FormData) {
  const admin = await requireAdmin();
  const productId = id(form, "product_id");
  await mutate(`/products/${productId}`, async () => {
    const kind = str(form, "kind") === "release" ? "release" : "maintenance";
    await recordChange(commerceRepo(), id(form), kind, str(form, "summary"), admin.userId);
    return { notice: kind === "maintenance" ? "Maintenance change recorded (included, no charge)." : "Release note recorded." };
  });
}

// ------------------------------------------------------------- CRM (HighLevel)

export async function adminDisconnectCrmAction(form: FormData) {
  await requireAdmin();
  const licenseId = id(form, "license_id");
  await mutate(`/licenses/${licenseId}`, async () => {
    const done = await disconnectCrm(crmDeps(), licenseId);
    return { notice: done ? "GoHighLevel disconnected for this license; stored credentials were deleted." : "This license had no GoHighLevel connection." };
  });
}
