import "server-only";
import { createHmac } from "node:crypto";
import { platformClient, tenantClient } from "../supabase/service";
import { connectStripe } from "./stripe-port";
import type { ConnectDeps } from "./service.ts";
import { SupabaseConnectRepo } from "./supabase-repo.ts";

/** The secret behind the OAuth state, derived from MONARCH_ENCRYPTION_KEY. Null when it is not configured. */
export function connectStateKey(): Buffer | null {
  const raw = process.env.MONARCH_ENCRYPTION_KEY;
  if (!raw) return null;
  const master = Buffer.from(raw, "base64");
  if (master.length !== 32) return null;
  return createHmac("sha256", master).update("monarch:connect-state:v1").digest();
}

/** Deps for one office, or null when Stripe Connect isn't configured on this deployment. */
export function connectDeps(tenantId: string): ConnectDeps | null {
  const s = connectStripe();
  if (!s) return null;
  return { tenantId, repo: new SupabaseConnectRepo(tenantClient(tenantId), tenantId), stripe: s.port };
}

/** The office a verified Connect event belongs to: found by the connected account id on the event. */
export async function tenantForConnectedAccount(account: string): Promise<string | null> {
  if (!/^acct_[A-Za-z0-9]{6,64}$/.test(account)) return null;
  const { data, error } = await platformClient("connect_webhook").from("payment_connections").select("tenant_id").eq("stripe_account_id", account).eq("status", "connected").maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.tenant_id as string | undefined) ?? null;
}
