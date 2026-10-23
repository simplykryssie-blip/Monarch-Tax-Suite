import "server-only";
import { cache } from "react";
import Stripe from "stripe";
import { CrmSecrets } from "../crm/crypto.ts";
import { tenantClient } from "../supabase/service";
import { currentTenantId, MONARCH_TENANT_ID } from "../tenants.ts";
import { connectPlatformKey } from "../connect/config.ts";
import { judgeProductLookups, parseSecretKey, parseWebhookSecret, resolveStoreStripe, type ConnectionFacts, type KeySource, type PriceLookup, type SavedKeys, type StripeMode } from "./keys.ts";

// A workspace's own storefront Stripe keys: read, decrypt, save, remove. Values stay on the server; what leaves this file for a
// page is only which keys are set, where they come from, their last four characters, and the mode.

type Row = { secret_key_enc: string; secret_key_hint: string; mode: StripeMode; webhook_secret_enc: string | null; webhook_secret_hint: string | null };
const COLUMNS = "secret_key_enc, secret_key_hint, mode, webhook_secret_enc, webhook_secret_hint";

const secrets = () => CrmSecrets.fromBase64(process.env.MONARCH_ENCRYPTION_KEY);
const aad = (tenantId: string, field: "secret_key" | "webhook_secret") => `tenant_store_stripe:${tenantId}:${field}`;

export type StoreStripe = {
  stripe: Stripe | null;
  secretKey: string | null;
  webhookSecret: string | null;
  mode: StripeMode | null;
  secretKeySource: KeySource;
  webhookSecretSource: KeySource;
  secretKeyHint: string | null;
  webhookSecretHint: string | null;
  /** The connected Stripe account the storefront runs on, when it does (Stripe Connect). */
  connectedAccount: string | null;
  /** Why a connection that exists is not being used, in plain words; null when there is none or it is in use. */
  connectionNote: string | null;
  /** What the workspace's saved connection says, for its screen (whether or not it is in use). */
  connection: ConnectionFacts | null;
};

async function readRow(tenantId: string): Promise<Row | null> {
  // A table that isn't there yet (migration not applied) or can't be read means "nothing saved": the environment still works.
  const { data, error } = await tenantClient(tenantId).from("tenant_store_stripe").select(COLUMNS).maybeSingle();
  return error ? null : ((data as Row | null) ?? null);
}

async function readConnection(tenantId: string): Promise<ConnectionFacts | null> {
  // The same connection row that serves client invoice payments. A table that isn't there yet means "not connected".
  const { data, error } = await tenantClient(tenantId).from("payment_connections").select("stripe_account_id, livemode, status, charges_enabled").maybeSingle();
  if (error || !data) return null;
  const d = data as { stripe_account_id: string; livemode: boolean; status: "connected" | "disconnected"; charges_enabled: boolean };
  return { accountId: d.stripe_account_id, livemode: d.livemode, status: d.status, chargesEnabled: d.charges_enabled };
}

function saved(row: Row | null, tenantId: string): SavedKeys | null {
  const s = secrets();
  if (!row || !s) return null;
  try {
    return {
      secretKey: s.decrypt(row.secret_key_enc, aad(tenantId, "secret_key")),
      webhookSecret: row.webhook_secret_enc ? s.decrypt(row.webhook_secret_enc, aad(tenantId, "webhook_secret")) : null,
    };
  } catch {
    // Unreadable (wrong master key): treated as not saved, never as a crash on the storefront.
    return null;
  }
}

/**
 * The workspace's storefront Stripe setup. Cached for the length of one request. Order of use: the connected Stripe account
 * (Verexa's Connect platform key, with the workspace's account named on every call), then keys saved in its settings, then
 * (Monarch only) the server's environment.
 */
export const loadStoreStripe = cache(async (tenantId: string = currentTenantId()): Promise<StoreStripe> => {
  const [row, connection] = await Promise.all([readRow(tenantId), readConnection(tenantId)]);
  const r = resolveStoreStripe({ connection, platformKey: connectPlatformKey(process.env), saved: saved(row, tenantId), env: process.env, isMonarch: tenantId === MONARCH_TENANT_ID });
  return {
    stripe: r.secretKey && r.mode ? new Stripe(r.secretKey, r.connectedAccount ? { stripeAccount: r.connectedAccount } : undefined) : null,
    secretKey: r.secretKey,
    webhookSecret: r.webhookSecret,
    mode: r.mode,
    secretKeySource: r.secretKeySource,
    webhookSecretSource: r.webhookSecretSource,
    secretKeyHint: r.secretKeySource === "settings" ? row?.secret_key_hint ?? null : null,
    webhookSecretHint: r.webhookSecretSource === "settings" ? row?.webhook_secret_hint ?? null : null,
    connectedAccount: r.connectedAccount,
    connectionNote: r.connectionNote,
    connection,
  };
});

/** The Stripe client for this workspace's storefront, or null when no usable key is set. */
export async function storeStripeClient(tenantId?: string): Promise<Stripe | null> {
  return (await loadStoreStripe(tenantId)).stripe;
}

export type SaveResult = { ok: true; mode: StripeMode | null } | { ok: false; error: string };

/** Saves a secret key and/or webhook signing secret. Either may be left blank to keep what is saved; a first save needs the key. */
export async function saveStoreStripe(tenantId: string, userId: string, input: { secretKey?: unknown; webhookSecret?: unknown }): Promise<SaveResult> {
  const s = secrets();
  if (!s) return { ok: false, error: "Saving keys isn't available: the server's encryption key isn't set." };
  const wantKey = typeof input.secretKey === "string" && input.secretKey.trim() !== "";
  const wantHook = typeof input.webhookSecret === "string" && input.webhookSecret.trim() !== "";
  if (!wantKey && !wantHook) return { ok: false, error: "Enter a key to save." };
  const key = wantKey ? parseSecretKey(input.secretKey) : null;
  if (key && !key.ok) return { ok: false, error: key.error };
  const hook = wantHook ? parseWebhookSecret(input.webhookSecret) : null;
  if (hook && !hook.ok) return { ok: false, error: hook.error };

  const existing = await readRow(tenantId);
  if (!key && !existing) return { ok: false, error: "Save the Stripe secret key first; the webhook signing secret goes with it." };
  const db = tenantClient(tenantId);
  const patch: Record<string, unknown> = { updated_by: userId };
  if (key?.ok) Object.assign(patch, { secret_key_enc: s.encrypt(key.value, aad(tenantId, "secret_key")), secret_key_hint: key.hint, mode: key.mode });
  if (hook?.ok) Object.assign(patch, { webhook_secret_enc: s.encrypt(hook.value, aad(tenantId, "webhook_secret")), webhook_secret_hint: hook.hint });
  const { error } = existing
    ? await db.from("tenant_store_stripe").update(patch).eq("tenant_id", tenantId)
    : await db.from("tenant_store_stripe").insert({ tenant_id: tenantId, ...patch });
  if (error) return { ok: false, error: "That didn't save. Nothing was changed. Please try again." };
  await db.from("workspace_audit_events").insert({ actor_id: userId, action: "store_stripe_saved", subject_type: "tenant_store_stripe", detail: { secret_key: key?.ok ? "replaced" : "kept", webhook_secret: hook?.ok ? "replaced" : "kept" } });
  return { ok: true, mode: key?.ok ? key.mode : existing?.mode ?? null };
}

/** Removes the saved keys. The server's environment (Monarch only) is then used again if it still has them. */
export async function removeStoreStripe(tenantId: string, userId: string): Promise<void> {
  const db = tenantClient(tenantId);
  await db.from("tenant_store_stripe").delete().eq("tenant_id", tenantId);
  await db.from("workspace_audit_events").insert({ actor_id: userId, action: "store_stripe_removed", subject_type: "tenant_store_stripe", detail: {} });
}

/** Asks Stripe, with the current key, whether it works. Returns a plain sentence either way. */
export async function checkStoreStripe(tenantId?: string): Promise<{ ok: boolean; message: string }> {
  const st = await loadStoreStripe(tenantId);
  if (!st.stripe) return { ok: false, message: "No usable Stripe secret key is set." };
  try {
    await st.stripe.prices.list({ limit: 1 });
    // Is it the right account? Ask for a few of the store's own prices.
    const { data } = await tenantClient(tenantId ?? currentTenantId()).from("products").select("stripe_price_id").not("stripe_price_id", "is", null).limit(3);
    const lookups: PriceLookup[] = [];
    for (const row of (data ?? []) as { stripe_price_id: string }[]) {
      try {
        await st.stripe.prices.retrieve(row.stripe_price_id);
        lookups.push("found");
      } catch (e) {
        lookups.push((e as { code?: string }).code === "resource_missing" ? "missing" : "error");
      }
    }
    const verdict = judgeProductLookups(lookups);
    return verdict.ok ? { ok: true, message: `Stripe accepted ${st.connectedAccount ? "the connected account" : "the key"} (${st.mode} mode).${verdict.message}` } : { ok: false, message: verdict.message };
  } catch (e) {
    const err = e as { type?: string; code?: string; statusCode?: number };
    const t = err.type;
    // What Stripe actually said, for whoever is diagnosing: the error's type, code and HTTP status only. Never the key,
    // never Stripe's message (which can quote part of the key).
    console.warn(JSON.stringify({ event: "store_stripe_check_failed", type: t ?? "unknown", code: err.code ?? null, status: err.statusCode ?? null, source: st.secretKeySource, mode: st.mode, key_chars: st.secretKey?.length ?? null }));
    if (st.connectedAccount && (t === "StripeAuthenticationError" || t === "StripePermissionError")) return { ok: false, message: "Stripe no longer accepts the connection to your account (it may have been disconnected from Stripe's side). Disconnect here and connect again." };
    if (t === "StripeAuthenticationError") return { ok: false, message: "Stripe rejected the key. Check that it is the right key for this Stripe account, and that it was copied completely: use Stripe's copy button and paste it, rather than retyping it." };
    if (t === "StripePermissionError") return { ok: false, message: "The key works but lacks permission to read prices. A restricted key needs read access to Prices." };
    return { ok: false, message: "Couldn't reach Stripe just now. Try again in a moment." };
  }
}
