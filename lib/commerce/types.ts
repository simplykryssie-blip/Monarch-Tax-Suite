// Domain types for the Monarch commerce/licensing CRM. Plain data only, so the
// fulfillment logic can run against Supabase in production and an in-memory
// store in tests.

export const PRODUCT_TYPES = ["software", "digital_download", "course", "membership", "service"] as const;
export const ACCESS_TYPES = ["license", "instant_download", "course_access", "manual"] as const;
export const PRODUCT_STATUSES = ["draft", "published", "unpublished", "archived"] as const;
export const INSTALLATION_TYPES = ["self_service", "done_for_you"] as const;
export const PLATFORMS = ["gohighlevel", "website", "jotform", "other"] as const;
export const INSTALLATION_STATUSES = ["requested", "in_progress", "blocked", "active", "removed"] as const;
export const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded", "partially_refunded", "canceled", "disputed"] as const;
export const LICENSE_STATUSES = ["pending", "active", "suspended", "revoked"] as const;
export const VERIFICATION_METHODS = ["stripe_webhook", "stripe_api", "admin_manual"] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];
export type AccessType = (typeof ACCESS_TYPES)[number];
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export type InstallationType = (typeof INSTALLATION_TYPES)[number];
export type Platform = (typeof PLATFORMS)[number];
export type InstallationStatus = (typeof INSTALLATION_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export type Product = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  product_type: ProductType;
  access_type: AccessType;
  installation_options: InstallationType[];
  price_cents: number | null;
  currency: string;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  status: ProductStatus;
  created_at: string;
  updated_at: string;
};

export type Customer = {
  id: string;
  email: string;
  full_name: string | null;
  status: "active" | "inactive" | "blocked";
  stripe_customer_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Order = {
  id: string;
  order_number: number;
  customer_id: string;
  product_id: string;
  amount_cents: number;
  amount_refunded_cents: number;
  currency: string;
  payment_status: PaymentStatus;
  provider: "stripe";
  provider_payment_intent_id: string | null;
  provider_checkout_session_id: string | null;
  installation_type: InstallationType;
  verification_method: VerificationMethod;
  verified_by: string | null;
  verified_at: string;
  notes: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type License = {
  id: string;
  customer_id: string;
  order_id: string;
  product_id: string;
  key_hash: string | null;
  key_prefix: string | null;
  status: LicenseStatus;
  max_domains: number;
  issued_at: string | null;
  activated_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type AuthorizedDomain = {
  id: string;
  license_id: string;
  domain: string;
  status: "active" | "removed";
  created_at: string;
};

export type Installation = {
  id: string;
  customer_id: string;
  order_id: string;
  license_id: string | null;
  product_id: string;
  installation_type: InstallationType;
  platform: Platform | null;
  target_location: string | null;
  status: InstallationStatus;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type LicenseEvent = {
  id: string;
  license_id: string;
  event_type: string;
  detail: Record<string, unknown>;
  actor_id: string | null;
  created_at: string;
};

export type InstallationEvent = {
  id: string;
  installation_id: string;
  from_status: InstallationStatus | null;
  to_status: InstallationStatus | null;
  note: string | null;
  actor_id: string | null;
  created_at: string;
};

export type NewProduct = Omit<Product, "id" | "created_at" | "updated_at">;
export type NewOrder = Omit<Order, "id" | "order_number" | "created_at" | "updated_at">;
export type NewLicense = Omit<License, "id" | "created_at" | "updated_at">;
export type NewInstallation = Omit<Installation, "id" | "created_at" | "updated_at">;

export type EventClaim = "new" | "duplicate";

// Storage port. Unique constraints (payment intent, order -> license,
// order -> installation, Stripe event id) are enforced by the store so that
// concurrent or repeated deliveries cannot create duplicates.
export interface CommerceRepo {
  listProducts(): Promise<Product[]>;
  getProduct(id: string): Promise<Product | null>;
  getProductByStripeProductId(stripeProductId: string): Promise<Product | null>;
  createProduct(input: NewProduct): Promise<Product>;
  updateProduct(id: string, patch: Partial<NewProduct>): Promise<Product>;

  listCustomers(): Promise<Customer[]>;
  getCustomer(id: string): Promise<Customer | null>;
  findCustomerByEmail(email: string): Promise<Customer | null>;
  createCustomer(input: { email: string; full_name: string | null; stripe_customer_id: string | null }): Promise<Customer>;
  updateCustomer(id: string, patch: Partial<Pick<Customer, "full_name" | "status" | "stripe_customer_id">>): Promise<Customer>;

  listOrders(): Promise<Order[]>;
  getOrder(id: string): Promise<Order | null>;
  findOrderByPaymentIntent(paymentIntentId: string): Promise<Order | null>;
  /** Inserts unless an order with the same payment intent exists; returns the existing one then. */
  createOrder(input: NewOrder): Promise<{ order: Order; created: boolean }>;
  updateOrder(id: string, patch: Partial<NewOrder>): Promise<Order>;

  /** Records a Stripe event id. "duplicate" means it was already fully processed. */
  claimStripeEvent(id: string, type: string): Promise<EventClaim>;
  finishStripeEvent(id: string, status: "processed" | "ignored" | "failed", error?: string): Promise<void>;

  listLicenses(): Promise<License[]>;
  getLicense(id: string): Promise<License | null>;
  findLicenseByOrder(orderId: string): Promise<License | null>;
  createLicense(input: NewLicense): Promise<{ license: License; created: boolean }>;
  updateLicense(id: string, patch: Partial<NewLicense>): Promise<License>;
  addLicenseEvent(input: Omit<LicenseEvent, "id" | "created_at">): Promise<void>;
  listLicenseEvents(licenseId: string): Promise<LicenseEvent[]>;
  listDomains(licenseId: string): Promise<AuthorizedDomain[]>;
  upsertDomain(licenseId: string, domain: string, status: AuthorizedDomain["status"]): Promise<AuthorizedDomain>;

  listInstallations(): Promise<Installation[]>;
  getInstallation(id: string): Promise<Installation | null>;
  findInstallationByOrder(orderId: string): Promise<Installation | null>;
  createInstallation(input: NewInstallation): Promise<{ installation: Installation; created: boolean }>;
  updateInstallation(id: string, patch: Partial<NewInstallation>): Promise<Installation>;
  addInstallationEvent(input: Omit<InstallationEvent, "id" | "created_at">): Promise<void>;
  listInstallationEvents(installationId: string): Promise<InstallationEvent[]>;
}
