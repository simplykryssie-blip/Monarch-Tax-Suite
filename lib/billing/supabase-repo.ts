import "server-only";
import { unwrap } from "../commerce/supabase-repo.ts";
import { platformClient } from "../supabase/service";
import type { Subscription } from "./access.ts";
import type { BillingRepo } from "./service.ts";

// Subscriptions are written only by the platform (the Stripe webhook and the daily sweep), never by a workspace's own
// request: the tenant role can read its own row and nothing else. Each platform use is logged with its reason.
const subs = () => platformClient("billing_webhook").from("tenant_subscriptions");
const events = () => platformClient("billing_webhook").from("billing_events");
const sweep = () => platformClient("billing_sweep").from("tenant_subscriptions");

export class SupabaseBillingRepo implements BillingRepo {
  async byTenant(tenantId: string) {
    return unwrap(await subs().select("*").eq("tenant_id", tenantId).maybeSingle()) as Subscription | null;
  }
  async bySubscription(subscriptionId: string) {
    return unwrap(await subs().select("*").eq("stripe_subscription_id", subscriptionId).maybeSingle()) as Subscription | null;
  }
  async byCustomer(customerId: string) {
    return unwrap(await subs().select("*").eq("stripe_customer_id", customerId).limit(1).maybeSingle()) as Subscription | null;
  }
  async insert(sub: Omit<Subscription, "created_at" | "updated_at">) {
    return unwrap(await subs().insert(sub).select("*").single()) as Subscription;
  }
  async update(tenantId: string, patch: Parameters<BillingRepo["update"]>[1]) {
    return unwrap(await subs().update(patch).eq("tenant_id", tenantId).select("*").single()) as Subscription;
  }
  async eventSeen(eventId: string) {
    const row = unwrap(await events().select("stripe_event_id").eq("stripe_event_id", eventId).maybeSingle());
    return row !== null;
  }
  async recordEvent(eventId: string, tenantId: string, type: string) {
    unwrap(await events().upsert({ stripe_event_id: eventId, tenant_id: tenantId, type }, { onConflict: "stripe_event_id", ignoreDuplicates: true }));
  }
  /** Workspaces whose subscription is late, paused or cancelled: no messages or automations run for them. */
  async restrictedTenantIds(): Promise<Set<string>> {
    const rows = unwrap(await sweep().select("tenant_id").in("status", ["suspended", "read_only", "paused", "canceled"]).limit(5000)) as { tenant_id: string }[];
    return new Set(rows.map((r) => r.tenant_id));
  }
  async sweepList() {
    return unwrap(await sweep().select("*").in("status", ["active", "suspended", "read_only", "paused"]).limit(2000)) as Subscription[];
  }
}
