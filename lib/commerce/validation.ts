import {
  ACCESS_TYPES,
  INSTALLATION_STATUSES,
  INSTALLATION_METHODS,
  INSTALLATION_TYPES,
  PLATFORMS,
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  type AccessType,
  type InstallationMethod,
  type InstallationStatus,
  type InstallationType,
  type NewProduct,
  type Platform,
  type ProductStatus,
  type ProductType,
} from "./types.ts";

export class ValidationError extends Error {}

type FormLike = { get(name: string): FormDataEntryValue | null; getAll(name: string): FormDataEntryValue[] };

function text(form: FormLike, name: string, max: number): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

export function oneOf<T extends string>(allowed: readonly T[], value: unknown, label: string): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new ValidationError(`Invalid ${label}.`);
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

/** Parses "75", "75.00", "$1,299.5" into cents. Empty means "not configured". */
export function parsePriceToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) throw new ValidationError("Price must be a dollar amount such as 75 or 75.00.");
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Enter a valid email address.");
  return email;
}

/** Accepts a bare host or URL and returns the lowercase hostname. */
export function normalizeDomain(input: string): string {
  let host = input.trim().toLowerCase();
  if (!host) throw new ValidationError("Enter a domain.");
  try {
    host = new URL(host.includes("://") ? host : `https://${host}`).hostname;
  } catch {
    throw new ValidationError("Enter a valid domain such as example.com.");
  }
  host = host.replace(/\.$/, "");
  if (host.length > 253 || !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
    throw new ValidationError("Enter a valid domain such as example.com.");
  }
  return host;
}

/** Accepts https URLs (a missing scheme is assumed https) and returns a normalized URL. */
export function normalizeWebsiteUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new ValidationError("Enter the website or funnel URL.");
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new ValidationError("Enter a valid website URL such as https://example.com/page.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ValidationError("Website URL must start with https://.");
  normalizeDomain(url.hostname);
  url.hash = "";
  return url.toString().slice(0, 500);
}

const STRIPE_ID = /^[a-z]{2,5}_[A-Za-z0-9]{6,255}$/;
export function optionalStripeId(value: string, prefix: string, label: string): string | null {
  if (!value) return null;
  if (!STRIPE_ID.test(value) || !value.startsWith(`${prefix}_`)) throw new ValidationError(`${label} must start with ${prefix}_.`);
  return value;
}

export function parseProductForm(form: FormLike): NewProduct {
  const name = text(form, "name", 120);
  if (name.length < 2) throw new ValidationError("Product name is required.");
  const slugInput = text(form, "slug", 80);
  const slug = slugify(slugInput || name);
  if (!slug) throw new ValidationError("Product identifier is required.");
  const installationOptions = form
    .getAll("installation_options")
    .map((v) => oneOf<InstallationType>(INSTALLATION_TYPES, v, "installation option"));
  const currency = (text(form, "currency", 3) || "usd").toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) throw new ValidationError("Currency must be a 3-letter code.");
  return {
    name,
    slug,
    description: text(form, "description", 2000) || null,
    product_type: oneOf<ProductType>(PRODUCT_TYPES, form.get("product_type"), "product type"),
    access_type: oneOf<AccessType>(ACCESS_TYPES, form.get("access_type"), "access type"),
    installation_options: [...new Set(installationOptions)],
    price_cents: parsePriceToCents(text(form, "price", 20)),
    currency,
    stripe_product_id: optionalStripeId(text(form, "stripe_product_id", 255), "prod", "Stripe product ID"),
    stripe_price_id: optionalStripeId(text(form, "stripe_price_id", 255), "price", "Stripe price ID"),
    status: "draft",
  };
}

export function parseProductStatus(value: unknown): ProductStatus {
  return oneOf<ProductStatus>(PRODUCT_STATUSES, value, "product status");
}

export function parseInstallationStatus(value: unknown): InstallationStatus {
  return oneOf<InstallationStatus>(INSTALLATION_STATUSES, value, "installation status");
}

export function parseInstallationType(value: unknown): InstallationType {
  return oneOf<InstallationType>(INSTALLATION_TYPES, value, "installation type");
}

export function parseInstallationMethod(value: unknown): InstallationMethod {
  return oneOf<InstallationMethod>(INSTALLATION_METHODS, value, "installation method");
}

export function parsePlatform(value: unknown): Platform {
  if (value === "" || value === null || value === undefined) throw new ValidationError("Choose the installation platform (use Other if it is not known yet).");
  return oneOf<Platform>(PLATFORMS, value, "platform");
}

export function cleanNote(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  const note = value.trim().slice(0, max);
  return note || null;
}

/** A product can be published only when it is genuinely sellable. */
export function publishBlockers(product: Pick<NewProduct, "price_cents" | "stripe_product_id" | "access_type" | "installation_options">): string[] {
  const blockers: string[] = [];
  if (product.price_cents === null) blockers.push("Set a verified price.");
  if (!product.stripe_product_id) blockers.push("Link the Stripe product so purchases can be fulfilled.");
  if (product.access_type === "license" && product.installation_options.length === 0) blockers.push("Choose at least one installation option.");
  return blockers;
}
