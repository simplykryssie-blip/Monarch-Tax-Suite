import { CALCULATOR_TAX_YEARS } from "../calculator/years.ts";
import { hashLicenseKey, isWellFormedLicenseKey } from "./license-keys.ts";
import { ValidationError } from "./validation.ts";
import type { CommerceRepo, License, Order, ProductVersion, VersionChange, VersionStatus } from "./types.ts";

// Version-aware licensing for one-time purchases with optional paid annual
// tax-year updates. There is no subscription and nothing renews: a license
// keeps the tax year it paid for until the customer buys a newer version.

export const DEFAULT_UPDATE_PRICE_CENTS = 5000;

/** Newest version an administrator has released for sale. */
export function latestAvailable(versions: ProductVersion[]): ProductVersion | null {
  return versions.filter((v) => v.status === "available").sort((a, b) => b.tax_year - a.tax_year)[0] ?? null;
}

/** Tax years the license may use, given what the calculator build contains. Never shrinks when newer versions ship. */
export function licensedYears(license: Pick<License, "licensed_tax_year">): number[] {
  const max = license.licensed_tax_year;
  return CALCULATOR_TAX_YEARS.filter((y) => max === null || y <= max);
}

export type UpdateOffer =
  | { eligible: true; currentYear: number; version: ProductVersion; priceCents: number }
  | { eligible: false; currentYear: number | null; latestYear: number | null; reason: "up_to_date" | "license_inactive" | "no_release" };

export function updateOffer(license: License, versions: ProductVersion[]): UpdateOffer {
  const latest = latestAvailable(versions);
  const current = license.licensed_tax_year;
  if (!latest) return { eligible: false, currentYear: current, latestYear: null, reason: "no_release" };
  if (license.status !== "active") return { eligible: false, currentYear: current, latestYear: latest.tax_year, reason: "license_inactive" };
  if (current === null || latest.tax_year <= current) return { eligible: false, currentYear: current, latestYear: latest.tax_year, reason: "up_to_date" };
  return { eligible: true, currentYear: current, version: latest, priceCents: latest.update_price_cents };
}

// ------------------------------------------------------------- admin release flow

export function parseTaxYear(value: unknown): number {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new ValidationError("Enter a tax year such as 2027.");
  return year;
}

export async function createVersion(
  repo: CommerceRepo,
  input: { product_id: string; tax_year: number; label: string | null; release_date: string | null; update_price_cents: number | null; stripe_update_price_id: string | null },
) {
  const product = await repo.getProduct(input.product_id);
  if (!product) throw new ValidationError("Product not found.");
  const existing = await repo.listVersions(product.id);
  if (existing.some((v) => v.tax_year === input.tax_year)) throw new ValidationError(`A ${input.tax_year} version already exists.`);
  return repo.createVersion({
    product_id: product.id,
    tax_year: input.tax_year,
    label: input.label || `${input.tax_year} Tax Year`,
    status: "draft",
    release_date: input.release_date,
    update_price_cents: input.update_price_cents ?? DEFAULT_UPDATE_PRICE_CENTS,
    stripe_update_price_id: input.stripe_update_price_id,
  });
}

export async function editVersion(
  repo: CommerceRepo,
  versionId: string,
  patch: { label?: string; release_date?: string | null; update_price_cents?: number; stripe_update_price_id?: string | null },
) {
  const version = await repo.getVersion(versionId);
  if (!version) throw new ValidationError("Version not found.");
  // A changed price or price id is no longer Stripe-verified: it must be checked again before publishing or selling.
  const changed = (patch.update_price_cents !== undefined && patch.update_price_cents !== version.update_price_cents) ||
    (patch.stripe_update_price_id !== undefined && patch.stripe_update_price_id !== version.stripe_update_price_id);
  return repo.updateVersion(version.id, changed ? { ...patch, stripe_verification: null } : patch);
}

/**
 * Marks a version available for purchase (or retires it). A version can only be
 * released when the deployed calculator actually contains that tax year.
 * Retiring stops new sales; it never removes access for licenses that own it.
 */
export async function setVersionStatus(repo: CommerceRepo, versionId: string, status: VersionStatus, actorId: string, now?: () => string) {
  const version = await repo.getVersion(versionId);
  if (!version) throw new ValidationError("Version not found.");
  if (status === "available") {
    if (!CALCULATOR_TAX_YEARS.includes(version.tax_year)) {
      throw new ValidationError(`The deployed calculator does not contain ${version.tax_year} tax data yet. Ship the ${version.tax_year} calculator code before releasing this version.`);
    }
    if (version.update_price_cents <= 0) throw new ValidationError("Set the update price first.");
  }
  const patch: Partial<ProductVersion> = { status };
  if (status === "available" && !version.release_date) patch.release_date = (now ? now() : new Date().toISOString()).slice(0, 10);
  const updated = await repo.updateVersion(version.id, patch);
  if (status === "available" && version.status !== "available") {
    await repo.addVersionChange({ version_id: version.id, kind: "release", summary: `${version.label} released for purchase.`, actor_id: actorId });
  }
  return updated;
}

/** Records a fix or correction for a version. Included for every license on that version: never charged. */
export async function recordChange(repo: CommerceRepo, versionId: string, kind: VersionChange["kind"], summary: string, actorId: string) {
  const version = await repo.getVersion(versionId);
  if (!version) throw new ValidationError("Version not found.");
  const text = summary.trim().slice(0, 1000);
  if (text.length < 3) throw new ValidationError("Describe the change.");
  return repo.addVersionChange({ version_id: version.id, kind, summary: text, actor_id: actorId });
}

// ------------------------------------------------------------- paid update application

/** Applies a paid annual-update order to its license. Idempotent; never downgrades. */
export async function applyPaidUpdate(repo: CommerceRepo, order: Order, actorId: string | null) {
  if (order.order_type !== "annual_update" || !order.license_id || order.tax_year === null) return null;
  if (order.payment_status !== "paid") return null;
  const license = await repo.getLicense(order.license_id);
  if (!license) throw new Error(`Update order ${order.id} references a missing license.`);
  if (license.status === "revoked") return license;
  if (license.licensed_tax_year !== null && license.licensed_tax_year >= order.tax_year) return license;
  const updated = await repo.updateLicense(license.id, { licensed_tax_year: order.tax_year });
  await repo.addLicenseEvent({
    license_id: license.id,
    event_type: "version_upgraded",
    detail: { from: license.licensed_tax_year, to: order.tax_year, order_id: order.id },
    actor_id: actorId,
  });
  return updated;
}

/** Reverses an update after a full refund or dispute; the base license is untouched. */
export async function reverseUpdate(repo: CommerceRepo, order: Order, reason: string) {
  if (order.order_type !== "annual_update" || !order.license_id || order.tax_year === null) return null;
  const license = await repo.getLicense(order.license_id);
  if (!license || license.licensed_tax_year !== order.tax_year) return license;
  const updated = await repo.updateLicense(license.id, { licensed_tax_year: order.previous_tax_year });
  await repo.addLicenseEvent({
    license_id: license.id,
    event_type: "version_reverted",
    detail: { from: order.tax_year, to: order.previous_tax_year, order_id: order.id, reason },
    actor_id: null,
  });
  return updated;
}

// ------------------------------------------------------------- customer update flow

/**
 * Resolves a license from the customer's license key (proof of ownership) and
 * returns what they may buy. Customers can only reach their own license: the
 * key is the credential and only its hash is stored.
 */
export async function lookupUpdate(repo: CommerceRepo, rawKey: string) {
  if (!isWellFormedLicenseKey(rawKey)) throw new ValidationError("Enter your license key (MTS-XXXXX-XXXXX-XXXXX-XXXXX).");
  const license = await repo.findLicenseByKeyHash(hashLicenseKey(rawKey));
  if (!license) throw new ValidationError("That license key was not found.");
  const [customer, versions] = await Promise.all([repo.getCustomer(license.customer_id), repo.listVersions(license.product_id)]);
  if (!customer) throw new ValidationError("That license key was not found.");
  return { license, customer, versions, offer: updateOffer(license, versions) };
}

export type StripePriceCheck = { active: boolean; type: string; unit_amount: number | null; currency: string; recurring: unknown };

/** The Stripe price for an update must be an active, one-time USD price matching the version price. */
export function assertOneTimeUpdatePrice(price: StripePriceCheck, version: ProductVersion) {
  if (!price.active) throw new ValidationError("The update price is not active in Stripe.");
  if (price.type !== "one_time" || price.recurring) throw new ValidationError("The update price must be a one-time price, not a subscription.");
  if (price.unit_amount !== version.update_price_cents || price.currency.toLowerCase() !== "usd") {
    throw new ValidationError("The Stripe update price does not match the price configured for this version.");
  }
}
