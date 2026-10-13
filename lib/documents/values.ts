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
