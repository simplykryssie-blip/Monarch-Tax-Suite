import type { Customer, Order, Product } from "../commerce/types.ts";
import type { TenantProfile } from "./types.ts";

// Merge field values for one client. Only fields the document may show; never keys, tokens or internal ids.

export function formatDate(at: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "long" }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "long" }).format(at);
  }
}

function money(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function documentValues(input: {
  profile: TenantProfile | null;
  customer: Pick<Customer, "full_name" | "email"> | null;
  businessName?: string | null;
  order?: Pick<Order, "order_number" | "amount_cents" | "currency" | "paid_at" | "created_at"> | null;
  product?: Pick<Product, "name"> | null;
  now: Date;
}): Record<string, string> {
  const tz = input.profile?.time_zone ?? "America/New_York";
  const values: Record<string, string> = {
    today: formatDate(input.now, tz),
    current_year: new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric" }).format(input.now),
  };
  if (input.profile) {
    values.firm_name = input.profile.display_name;
    values.firm_legal_name = input.profile.legal_name;
    values.firm_email = input.profile.email ?? "";
    values.firm_phone = input.profile.phone ?? "";
    values.firm_address = input.profile.address ?? "";
    values.firm_ptin = input.profile.ptin ?? "";
    values.firm_caf_number = input.profile.caf_number ?? "";
  }
  if (input.customer) {
    const name = input.customer.full_name?.trim() ?? "";
    values.client_name = name;
    values.client_first_name = name.split(/\s+/)[0] ?? "";
    values.client_email = input.customer.email;
    values.client_business_name = input.businessName?.trim() ?? "";
  }
  if (input.order) {
    values.order_number = String(input.order.order_number);
    values.order_date = formatDate(new Date(input.order.paid_at ?? input.order.created_at), tz);
    values.amount_paid = money(input.order.amount_cents, input.order.currency);
  }
  if (input.product) values.product_name = input.product.name;
  return values;
}

/** Merge values for a client of an office (a portal document): the client's record and the office's profile. The full SSN is added separately, on the server, only when the document asks for it. */
export function clientDocumentValues(input: {
  profile: TenantProfile | null;
  client: { full_name: string; email: string | null; phone: string | null; address: string | null; ssn_last4: string | null };
  now: Date;
}): Record<string, string> {
  const values = documentValues({ profile: input.profile, customer: null, now: input.now });
  const name = input.client.full_name.trim();
  values.client_name = name;
  values.client_first_name = name.split(/\s+/)[0] ?? "";
  values.client_email = input.client.email ?? "";
  values.client_phone = input.client.phone ?? "";
  values.client_address = input.client.address ?? "";
  values.client_ssn_last4 = input.client.ssn_last4 ?? "";
  values.client_business_name = "";
  return values;
}
