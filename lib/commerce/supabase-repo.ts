import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ImageStore,
  ImageType,
  AuthorizedDomain,
  CommerceRepo,
  Customer,
  Installation,
  InstallationEvent,
  License,
  LicenseEvent,
  NewInstallation,
  NewLicense,
  NewOrder,
  NewProduct,
  NewProductVersion,
  Order,
  Product,
  ProductImage,
  ProductVersion,
  VersionChange,
} from "./types.ts";

// Thrown when the commerce tables are missing (migration not applied yet), so
// pages can show a setup notice instead of crashing or showing fake data.
export class SetupRequiredError extends Error {}

type Result<T> = { data: T | null; error: { code?: string; message: string } | null };

export function unwrap<T>({ data, error }: Result<T>): T {
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205" || error.code === "42703") throw new SetupRequiredError(error.message);
    throw new Error(error.message);
  }
  return data as T;
}

export const isUniqueViolation = (error: { code?: string } | null) => error?.code === "23505";

// ---------------------------------------------------------------------------
// Column mapping onto the original licensing schema (migration
// 20261008224443): those tables keep their existing column names and values.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function licenseFromRow(row: Row | null): License | null {
  if (!row) return null;
  const { license_key_hash, ...rest } = row;
  return { ...rest, key_hash: license_key_hash ?? null } as License;
}
function licenseToRow(patch: Partial<NewLicense>): Row {
  const { key_hash, ...rest } = patch;
  return key_hash === undefined ? rest : { ...rest, license_key_hash: key_hash };
}

// Existing values 'ghl' and 'website' are kept; 'website' is a custom HTML site.
const PLATFORM_TO_DB: Record<string, string> = { gohighlevel: "ghl", shopify: "shopify", wix: "wix", jotform: "jotform", custom_html: "website", other: "other" };
const PLATFORM_FROM_DB: Record<string, string> = { ghl: "gohighlevel", shopify: "shopify", wix: "wix", jotform: "jotform", website: "custom_html", other: "other" };
function installationFromRow(row: Row | null): Installation | null {
  if (!row) return null;
  const { domain, notes, platform, ...rest } = row;
  return { ...rest, target_location: domain ?? null, internal_notes: notes ?? null, platform: PLATFORM_FROM_DB[String(platform)] ?? "other" } as Installation;
}
function installationToRow(patch: Partial<NewInstallation>): Row {
  const { target_location, internal_notes, platform, ...rest } = patch;
  const row: Row = { ...rest };
  if (target_location !== undefined) row.domain = target_location;
  if (internal_notes !== undefined) row.notes = internal_notes;
  if (platform !== undefined) row.platform = PLATFORM_TO_DB[platform];
  return row;
}

function domainFromRow(row: Row): AuthorizedDomain {
  const { verification_status, ...rest } = row;
  return { ...rest, status: verification_status === "verified" ? "active" : "removed" } as AuthorizedDomain;
}

function licenseEventFromRow(row: Row): LicenseEvent {
  const { details, ...rest } = row;
  return { ...rest, detail: (details as Record<string, unknown>) ?? {} } as LicenseEvent;
}

/** CommerceRepo backed by Supabase. Must be constructed with a service-role client, server-side only. */
export class SupabaseCommerceRepo implements CommerceRepo {
  constructor(private db: SupabaseClient) {}

  private async one<T>(table: string, column: string, value: string): Promise<T | null> {
    return unwrap(await this.db.from(table).select("*").eq(column, value).maybeSingle()) as T | null;
  }
  private async all<T>(table: string, order = "created_at", ascending = false): Promise<T[]> {
    return unwrap(await this.db.from(table).select("*").order(order, { ascending })) as T[];
  }
  private async insert<T>(table: string, row: object): Promise<T> {
    return unwrap(await this.db.from(table).insert(row).select("*").single()) as T;
  }
  private async patch<T>(table: string, id: string, patch: object): Promise<T> {
    return unwrap(await this.db.from(table).update(patch).eq("id", id).select("*").single()) as T;
  }
  /** Insert that returns the existing row when a unique key already exists. */
  private async insertOrGet<T>(table: string, row: object, column: string, value: string | null): Promise<{ row: T; created: boolean }> {
    const result = await this.db.from(table).insert(row).select("*").single();
    if (isUniqueViolation(result.error) && value) {
      const existing = await this.one<T>(table, column, value);
      if (existing) return { row: existing, created: false };
    }
    return { row: unwrap(result) as T, created: true };
  }

  listProducts() { return this.all<Product>("products", "name", true); }
  getProduct(id: string) { return this.one<Product>("products", "id", id); }
  getProductByStripeProductId(id: string) { return this.one<Product>("products", "stripe_product_id", id); }
  createProduct(input: NewProduct) { return this.insert<Product>("products", input); }
  updateProduct(id: string, patch: Partial<NewProduct>) { return this.patch<Product>("products", id, patch); }

  async listProductImages(productIds: string[]) {
    if (productIds.length === 0) return [];
    return unwrap(await this.db.from("product_images").select("*").in("product_id", productIds).order("sort_order", { ascending: true })) as ProductImage[];
  }
  getProductImage(id: string) { return this.one<ProductImage>("product_images", "id", id); }
  addProductImage(input: Omit<ProductImage, "id" | "created_at">) { return this.insert<ProductImage>("product_images", input); }
  updateProductImage(id: string, patch: Partial<Pick<ProductImage, "is_primary" | "sort_order" | "alt_text">>) { return this.patch<ProductImage>("product_images", id, patch); }
  async deleteProductImage(id: string) { unwrap(await this.db.from("product_images").delete().eq("id", id)); }

  async listVersions(productId: string) {
    return unwrap(await this.db.from("product_versions").select("*").eq("product_id", productId).order("tax_year", { ascending: false })) as ProductVersion[];
  }
  getVersion(id: string) { return this.one<ProductVersion>("product_versions", "id", id); }
  createVersion(input: NewProductVersion) { return this.insert<ProductVersion>("product_versions", input); }
  updateVersion(id: string, patch: Partial<NewProductVersion>) { return this.patch<ProductVersion>("product_versions", id, patch); }
  addVersionChange(input: Omit<VersionChange, "id" | "created_at">) { return this.insert<VersionChange>("product_version_changes", input); }
  async listVersionChanges(versionId: string) {
    return unwrap(await this.db.from("product_version_changes").select("*").eq("version_id", versionId).order("created_at", { ascending: false })) as VersionChange[];
  }

  listCustomers() { return this.all<Customer>("calculator_customers"); }
  getCustomer(id: string) { return this.one<Customer>("calculator_customers", "id", id); }
  findCustomerByEmail(email: string) { return this.one<Customer>("calculator_customers", "email", email.toLowerCase()); }
  async createCustomer(input: { email: string; full_name: string | null; stripe_customer_id: string | null }) {
    const { row } = await this.insertOrGet<Customer>("calculator_customers", { ...input, email: input.email.toLowerCase(), status: "active" }, "email", input.email.toLowerCase());
    return row;
  }
  updateCustomer(id: string, patch: Partial<Customer>) { return this.patch<Customer>("calculator_customers", id, patch); }

  listOrders() { return this.all<Order>("orders"); }
  async findOpenUpdateCheckout(licenseId: string, taxYear: number, now: string) {
    return unwrap(
      await this.db.from("update_checkout_sessions").select("stripe_session_id, expires_at").eq("license_id", licenseId).eq("tax_year", taxYear).gt("expires_at", now).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ) as { stripe_session_id: string; expires_at: string } | null;
  }
  async recordUpdateCheckout(input: { license_id: string; tax_year: number; stripe_session_id: string; expires_at: string }) {
    unwrap(await this.db.from("update_checkout_sessions").insert(input));
  }
  getOrder(id: string) { return this.one<Order>("orders", "id", id); }
  findOrderByPaymentIntent(pi: string) { return this.one<Order>("orders", "provider_payment_intent_id", pi); }
  async createOrder(input: NewOrder) {
    const { row, created } = await this.insertOrGet<Order>("orders", input, "provider_payment_intent_id", input.provider_payment_intent_id);
    return { order: row, created };
  }
  updateOrder(id: string, patch: Partial<NewOrder>) { return this.patch<Order>("orders", id, patch); }

  async claimStripeEvent(id: string, type: string) {
    const inserted = await this.db.from("stripe_events").insert({ id, type, status: "processing" });
    if (!inserted.error) return "new" as const;
    if (!isUniqueViolation(inserted.error)) unwrap(inserted);
    // Seen before: only a failed attempt may be retried.
    const retry = await this.db.from("stripe_events").update({ status: "processing", error: null }).eq("id", id).eq("status", "failed").select("id");
    return (unwrap(retry) as unknown[]).length ? ("new" as const) : ("duplicate" as const);
  }
  async finishStripeEvent(id: string, status: "processed" | "ignored" | "failed", error?: string) {
    unwrap(await this.db.from("stripe_events").update({ status, error: error ?? null, processed_at: new Date().toISOString() }).eq("id", id));
  }

  async listLicenses() { return (await this.all<Row>("calculator_licenses")).map((r) => licenseFromRow(r)!); }
  async getLicense(id: string) { return licenseFromRow(await this.one<Row>("calculator_licenses", "id", id)); }
  async findLicenseByOrder(orderId: string) { return licenseFromRow(await this.one<Row>("calculator_licenses", "order_id", orderId)); }
  async findLicenseByKeyHash(hash: string) { return licenseFromRow(await this.one<Row>("calculator_licenses", "license_key_hash", hash)); }
  async findLicenseByEmbedId(embedId: string) { return licenseFromRow(await this.one<Row>("calculator_licenses", "embed_id", embedId)); }
  async createLicense(input: NewLicense) {
    const { row, created } = await this.insertOrGet<Row>("calculator_licenses", licenseToRow(input), "order_id", input.order_id);
    return { license: licenseFromRow(row)!, created };
  }
  async updateLicense(id: string, patch: Partial<NewLicense>) { return licenseFromRow(await this.patch<Row>("calculator_licenses", id, licenseToRow(patch)))!; }
  async addLicenseEvent(input: Omit<LicenseEvent, "id" | "created_at">) {
    const { detail, ...rest } = input;
    unwrap(await this.db.from("calculator_license_events").insert({ ...rest, details: detail, source: input.actor_id ? "admin" : "stripe" }));
  }
  async listLicenseEvents(licenseId: string) {
    const rows = unwrap(await this.db.from("calculator_license_events").select("*").eq("license_id", licenseId).order("created_at", { ascending: true })) as Row[];
    return rows.map(licenseEventFromRow);
  }
  async findActiveDomainHolders(domains: string[]) {
    const rows = unwrap(await this.db.from("calculator_authorized_domains").select("license_id").in("domain", domains).eq("verification_status", "verified")) as { license_id: string }[];
    return [...new Set(rows.map((r) => r.license_id))];
  }
  async listDomains(licenseId: string) {
    const rows = unwrap(await this.db.from("calculator_authorized_domains").select("*").eq("license_id", licenseId).order("created_at")) as Row[];
    return rows.map(domainFromRow);
  }
  async upsertDomain(licenseId: string, domain: string, status: AuthorizedDomain["status"]) {
    // Administrator-authorized domains are recorded as verified; removed ones as rejected.
    const row: Row = { license_id: licenseId, domain, verification_status: status === "active" ? "verified" : "rejected" };
    if (status === "active") row.verified_at = new Date().toISOString();
    return domainFromRow(unwrap(await this.db.from("calculator_authorized_domains").upsert(row, { onConflict: "license_id,domain" }).select("*").single()) as Row);
  }

  async listInstallations() { return (await this.all<Row>("calculator_installations", "updated_at")).map((r) => installationFromRow(r)!); }
  async getInstallation(id: string) { return installationFromRow(await this.one<Row>("calculator_installations", "id", id)); }
  async findInstallationByOrder(orderId: string) { return installationFromRow(await this.one<Row>("calculator_installations", "order_id", orderId)); }
  async findInstallationByIntakeTokenHash(hash: string) { return installationFromRow(await this.one<Row>("calculator_installations", "intake_token_hash", hash)); }
  async createInstallation(input: NewInstallation) {
    const { row, created } = await this.insertOrGet<Row>("calculator_installations", installationToRow(input), "order_id", input.order_id);
    return { installation: installationFromRow(row)!, created };
  }
  async updateInstallation(id: string, patch: Partial<NewInstallation>) {
    return installationFromRow(await this.patch<Row>("calculator_installations", id, installationToRow(patch)))!;
  }
  async addInstallationEvent(input: Omit<InstallationEvent, "id" | "created_at">) { unwrap(await this.db.from("installation_events").insert(input)); }
  async listInstallationEvents(id: string) {
    return unwrap(await this.db.from("installation_events").select("*").eq("installation_id", id).order("created_at", { ascending: true })) as InstallationEvent[];
  }
}

export const PRODUCT_IMAGE_BUCKET = "product-images";

/** Supabase Storage for product images; service-role client only (server-side). */
export class SupabaseImageStore implements ImageStore {
  constructor(private db: SupabaseClient) {}
  private bucket() { return this.db.storage.from(PRODUCT_IMAGE_BUCKET); }
  async put(path: string, bytes: Uint8Array, contentType: ImageType) {
    const { error } = await this.bucket().upload(path, bytes, { contentType, upsert: false, cacheControl: "31536000" });
    if (error) throw new Error(`Image upload failed: ${error.message}`);
  }
  async remove(paths: string[]) {
    if (paths.length === 0) return;
    const { error } = await this.bucket().remove(paths);
    if (error) throw new Error(`Image removal failed: ${error.message}`);
  }
  async copy(from: string, to: string) {
    const { error } = await this.bucket().copy(from, to);
    if (error) throw new Error(`Image copy failed: ${error.message}`);
  }
  publicUrl(path: string) { return this.bucket().getPublicUrl(path).data.publicUrl; }
}
