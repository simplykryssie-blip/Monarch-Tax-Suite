import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
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
  Order,
  Product,
} from "./types.ts";

// Thrown when the commerce tables are missing (migration not applied yet), so
// pages can show a setup notice instead of crashing or showing fake data.
export class SetupRequiredError extends Error {}

type Result<T> = { data: T | null; error: { code?: string; message: string } | null };

function unwrap<T>({ data, error }: Result<T>): T {
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205" || error.code === "42703") throw new SetupRequiredError(error.message);
    throw new Error(error.message);
  }
  return data as T;
}

const isUniqueViolation = (error: { code?: string } | null) => error?.code === "23505";

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

  listCustomers() { return this.all<Customer>("calculator_customers"); }
  getCustomer(id: string) { return this.one<Customer>("calculator_customers", "id", id); }
  findCustomerByEmail(email: string) { return this.one<Customer>("calculator_customers", "email", email.toLowerCase()); }
  async createCustomer(input: { email: string; full_name: string | null; stripe_customer_id: string | null }) {
    const { row } = await this.insertOrGet<Customer>("calculator_customers", { ...input, email: input.email.toLowerCase(), status: "active" }, "email", input.email.toLowerCase());
    return row;
  }
  updateCustomer(id: string, patch: Partial<Customer>) { return this.patch<Customer>("calculator_customers", id, patch); }

  listOrders() { return this.all<Order>("orders"); }
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

  listLicenses() { return this.all<License>("calculator_licenses"); }
  getLicense(id: string) { return this.one<License>("calculator_licenses", "id", id); }
  findLicenseByOrder(orderId: string) { return this.one<License>("calculator_licenses", "order_id", orderId); }
  async createLicense(input: NewLicense) {
    const { row, created } = await this.insertOrGet<License>("calculator_licenses", input, "order_id", input.order_id);
    return { license: row, created };
  }
  updateLicense(id: string, patch: Partial<NewLicense>) { return this.patch<License>("calculator_licenses", id, patch); }
  async addLicenseEvent(input: Omit<LicenseEvent, "id" | "created_at">) { unwrap(await this.db.from("calculator_license_events").insert(input)); }
  async listLicenseEvents(licenseId: string) {
    return unwrap(await this.db.from("calculator_license_events").select("*").eq("license_id", licenseId).order("created_at", { ascending: true })) as LicenseEvent[];
  }
  async listDomains(licenseId: string) {
    return unwrap(await this.db.from("calculator_authorized_domains").select("*").eq("license_id", licenseId).order("created_at")) as AuthorizedDomain[];
  }
  async upsertDomain(licenseId: string, domain: string, status: AuthorizedDomain["status"]) {
    return unwrap(
      await this.db.from("calculator_authorized_domains").upsert({ license_id: licenseId, domain, status }, { onConflict: "license_id,domain" }).select("*").single(),
    ) as AuthorizedDomain;
  }

  listInstallations() { return this.all<Installation>("calculator_installations", "updated_at"); }
  getInstallation(id: string) { return this.one<Installation>("calculator_installations", "id", id); }
  findInstallationByOrder(orderId: string) { return this.one<Installation>("calculator_installations", "order_id", orderId); }
  async createInstallation(input: NewInstallation) {
    const { row, created } = await this.insertOrGet<Installation>("calculator_installations", input, "order_id", input.order_id);
    return { installation: row, created };
  }
  updateInstallation(id: string, patch: Partial<NewInstallation>) { return this.patch<Installation>("calculator_installations", id, patch); }
  async addInstallationEvent(input: Omit<InstallationEvent, "id" | "created_at">) { unwrap(await this.db.from("installation_events").insert(input)); }
  async listInstallationEvents(id: string) {
    return unwrap(await this.db.from("installation_events").select("*").eq("installation_id", id).order("created_at", { ascending: true })) as InstallationEvent[];
  }
}
