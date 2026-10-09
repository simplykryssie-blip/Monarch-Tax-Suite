import { randomUUID } from "node:crypto";
import type {
  AuthorizedDomain,
  CommerceRepo,
  Customer,
  Installation,
  InstallationEvent,
  License,
  LicenseEvent,
  Order,
  Product,
} from "../lib/commerce/types.ts";

// In-memory CommerceRepo enforcing the same unique constraints as the SQL
// migration, so idempotency behavior is tested the way production stores it.
export class MemoryRepo implements CommerceRepo {
  products: Product[] = [];
  customers: Customer[] = [];
  orders: Order[] = [];
  events = new Map<string, { type: string; status: string; error?: string }>();
  licenses: License[] = [];
  licenseEvents: LicenseEvent[] = [];
  domains: AuthorizedDomain[] = [];
  installations: Installation[] = [];
  installationEvents: InstallationEvent[] = [];
  private seq = 1000;
  private ts = () => new Date().toISOString();
  private clone = <T>(v: T): T => structuredClone(v);

  async listProducts() { return this.clone(this.products); }
  async getProduct(id: string) { return this.clone(this.products.find((p) => p.id === id) ?? null); }
  async getProductByStripeProductId(id: string) { return this.clone(this.products.find((p) => p.stripe_product_id === id) ?? null); }
  async createProduct(input: Omit<Product, "id" | "created_at" | "updated_at">) {
    if (this.products.some((p) => p.slug === input.slug)) throw new Error("duplicate slug");
    const row = { ...input, id: randomUUID(), created_at: this.ts(), updated_at: this.ts() };
    this.products.push(row);
    return this.clone(row);
  }
  async updateProduct(id: string, patch: Partial<Product>) { return this.patch(this.products, id, patch); }

  async listCustomers() { return this.clone(this.customers); }
  async getCustomer(id: string) { return this.clone(this.customers.find((c) => c.id === id) ?? null); }
  async findCustomerByEmail(email: string) { return this.clone(this.customers.find((c) => c.email === email.toLowerCase()) ?? null); }
  async createCustomer(input: { email: string; full_name: string | null; stripe_customer_id: string | null }) {
    if (this.customers.some((c) => c.email === input.email.toLowerCase())) throw new Error("duplicate email");
    const row: Customer = { ...input, email: input.email.toLowerCase(), status: "active", id: randomUUID(), created_at: this.ts(), updated_at: this.ts() };
    this.customers.push(row);
    return this.clone(row);
  }
  async updateCustomer(id: string, patch: Partial<Customer>) { return this.patch(this.customers, id, patch); }

  async listOrders() { return this.clone(this.orders); }
  async getOrder(id: string) { return this.clone(this.orders.find((o) => o.id === id) ?? null); }
  async findOrderByPaymentIntent(pi: string) { return this.clone(this.orders.find((o) => o.provider_payment_intent_id === pi) ?? null); }
  async createOrder(input: Omit<Order, "id" | "order_number" | "created_at" | "updated_at">) {
    const existing = input.provider_payment_intent_id ? this.orders.find((o) => o.provider_payment_intent_id === input.provider_payment_intent_id) : undefined;
    if (existing) return { order: this.clone(existing), created: false };
    const row: Order = { ...input, id: randomUUID(), order_number: ++this.seq, created_at: this.ts(), updated_at: this.ts() };
    this.orders.push(row);
    return { order: this.clone(row), created: true };
  }
  async updateOrder(id: string, patch: Partial<Order>) { return this.patch(this.orders, id, patch); }

  async claimStripeEvent(id: string, type: string) {
    const existing = this.events.get(id);
    if (existing && existing.status !== "failed") return "duplicate" as const;
    this.events.set(id, { type, status: "processing" });
    return "new" as const;
  }
  async finishStripeEvent(id: string, status: "processed" | "ignored" | "failed", error?: string) {
    this.events.set(id, { type: this.events.get(id)?.type ?? "", status, error });
  }

  async listLicenses() { return this.clone(this.licenses); }
  async getLicense(id: string) { return this.clone(this.licenses.find((l) => l.id === id) ?? null); }
  async findLicenseByOrder(orderId: string) { return this.clone(this.licenses.find((l) => l.order_id === orderId) ?? null); }
  async findLicenseByEmbedId(embedId: string) { return this.clone(this.licenses.find((l) => l.embed_id === embedId) ?? null); }
  async createLicense(input: Omit<License, "id" | "created_at" | "updated_at">) {
    const existing = this.licenses.find((l) => l.order_id === input.order_id);
    if (existing) return { license: this.clone(existing), created: false };
    const row = { ...input, id: randomUUID(), created_at: this.ts(), updated_at: this.ts() };
    this.licenses.push(row);
    return { license: this.clone(row), created: true };
  }
  async updateLicense(id: string, patch: Partial<License>) { return this.patch(this.licenses, id, patch); }
  async addLicenseEvent(input: Omit<LicenseEvent, "id" | "created_at">) { this.licenseEvents.push({ ...input, id: randomUUID(), created_at: this.ts() }); }
  async listLicenseEvents(licenseId: string) { return this.clone(this.licenseEvents.filter((e) => e.license_id === licenseId)); }
  async listDomains(licenseId: string) { return this.clone(this.domains.filter((d) => d.license_id === licenseId)); }
  async upsertDomain(licenseId: string, domain: string, status: AuthorizedDomain["status"]) {
    const existing = this.domains.find((d) => d.license_id === licenseId && d.domain === domain);
    if (existing) { existing.status = status; return this.clone(existing); }
    const row: AuthorizedDomain = { id: randomUUID(), license_id: licenseId, domain, status, created_at: this.ts() };
    this.domains.push(row);
    return this.clone(row);
  }

  async listInstallations() { return this.clone(this.installations); }
  async getInstallation(id: string) { return this.clone(this.installations.find((i) => i.id === id) ?? null); }
  async findInstallationByOrder(orderId: string) { return this.clone(this.installations.find((i) => i.order_id === orderId) ?? null); }
  async findInstallationByIntakeTokenHash(hash: string) { return this.clone(this.installations.find((i) => i.intake_token_hash === hash) ?? null); }
  async createInstallation(input: Omit<Installation, "id" | "created_at" | "updated_at">) {
    const existing = this.installations.find((i) => i.order_id === input.order_id);
    if (existing) return { installation: this.clone(existing), created: false };
    const row = { ...input, id: randomUUID(), created_at: this.ts(), updated_at: this.ts() };
    this.installations.push(row);
    return { installation: this.clone(row), created: true };
  }
  async updateInstallation(id: string, patch: Partial<Installation>) { return this.patch(this.installations, id, patch); }
  async addInstallationEvent(input: Omit<InstallationEvent, "id" | "created_at">) { this.installationEvents.push({ ...input, id: randomUUID(), created_at: this.ts() }); }
  async listInstallationEvents(id: string) { return this.clone(this.installationEvents.filter((e) => e.installation_id === id)); }

  private async patch<T extends { id: string; updated_at?: string }>(rows: T[], id: string, patch: Partial<T>): Promise<T> {
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error("not found");
    Object.assign(row, patch, "updated_at" in row ? { updated_at: this.ts() } : {});
    return this.clone(row);
  }
}
