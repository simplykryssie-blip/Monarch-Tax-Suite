import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { createClient } from "./supabase/server";
import { serviceClient } from "./supabase/service";
import { decideAdmin } from "./commerce/authz.ts";
import { SupabaseCommerceRepo, SupabaseImageStore } from "./commerce/supabase-repo.ts";

export { serviceClient };

export function commerceRepo() {
  return new SupabaseCommerceRepo(serviceClient());
}

/** Product image storage (service role; call only after requireAdmin for writes). */
export function imageStore() {
  return new SupabaseImageStore(serviceClient());
}

/** Stripe client, or null when STRIPE_SECRET_KEY is not configured. */
export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key) : null;
}

type AdminLookup = "yes" | "no" | "setup_missing";

async function lookupAdmin(userId: string): Promise<AdminLookup> {
  const { data, error } = await serviceClient().from("admin_users").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) {
    // Missing table means the migration has not been applied: nobody is an admin yet.
    if (error.code === "42P01" || error.code === "PGRST205") return "setup_missing";
    throw new Error(error.message);
  }
  return data ? "yes" : "no";
}

export type AdminSession = { userId: string; email: string };

/** Verifies the signed-in user is a Monarch administrator. Use in every admin page and server action. */
export const requireAdmin = cache(async (): Promise<AdminSession> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let setupMissing = false;
  const decision = await decideAdmin(user, async (id) => {
    const result = await lookupAdmin(id);
    setupMissing = result === "setup_missing";
    return result === "yes";
  });
  if (!decision.allowed) {
    if (decision.reason === "unauthenticated") redirect("/login");
    const message = setupMissing
      ? "Administrator access is not set up yet. Apply the Monarch commerce database migration."
      : "This account is not a Monarch administrator.";
    redirect("/login?error=" + encodeURIComponent(message));
  }
  return { userId: decision.userId, email: user?.email ?? "" };
});

/** Public origin of this deployment (for embed and intake links). */
export async function appOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "monarch-tax-suite.vercel.app";
  return `https://${host}`;
}
