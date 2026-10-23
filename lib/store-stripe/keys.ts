// A workspace's own storefront Stripe keys (secret key and webhook signing secret). Pure rules, so they can be tested;
// the database and encryption are in server.ts. Today only Monarch sells through the storefront.
//
// Where the storefront's Stripe access comes from, in order: the workspace's connected Stripe account (Stripe Connect, the
// click-to-connect path), then the keys saved in its own settings, then (Monarch only, until the move is done and the old
// environment variables are removed) the server's environment. The keys path stays as the permanent fallback. Values are
// never returned to a page.

export type StripeMode = "test" | "live";

export type ParsedKey = { ok: true; value: string; mode: StripeMode; hint: string } | { ok: false; error: string };

const SECRET = /^(sk|rk)_(test|live)_[A-Za-z0-9]{16,250}$/;
const WEBHOOK = /^whsec_[A-Za-z0-9+/=_-]{16,200}$/;

/** The last four characters, so the owner can tell which key is saved without the key ever being shown. */
export const keyHint = (value: string) => value.slice(-4);

export function parseSecretKey(raw: unknown): ParsedKey {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return { ok: false, error: "Enter the Stripe secret key." };
  if (/^pk_/.test(v)) return { ok: false, error: "That is a publishable key (pk_…). Use the secret key (sk_…) or a restricted key (rk_…)." };
  const m = SECRET.exec(v);
  if (!m) return { ok: false, error: "That doesn't look like a Stripe secret key. It starts with sk_test_ / sk_live_ (or rk_test_ / rk_live_ for a restricted key)." };
  return { ok: true, value: v, mode: m[2] as StripeMode, hint: keyHint(v) };
}

export type ParsedSecret = { ok: true; value: string; hint: string } | { ok: false; error: string };

export function parseWebhookSecret(raw: unknown): ParsedSecret {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return { ok: false, error: "Enter the webhook signing secret." };
  if (!WEBHOOK.test(v)) return { ok: false, error: "That doesn't look like a webhook signing secret. It starts with whsec_ and is shown on the webhook's page in Stripe." };
  return { ok: true, value: v, hint: keyHint(v) };
}

export const modeOfKey = (key: string | null | undefined): StripeMode | null => {
  const m = /^(?:sk|rk)_(test|live)_/.exec(key ?? "");
  return m ? (m[1] as StripeMode) : null;
};

export type SavedKeys = { secretKey: string | null; webhookSecret: string | null };
export type KeySource = "connected" | "settings" | "environment" | null;
export type ResolvedKeys = { secretKey: string | null; webhookSecret: string | null; secretKeySource: KeySource; webhookSecretSource: KeySource };

/**
 * Settings win. Only the Monarch workspace may still fall back to the server's environment, which keeps the live store
 * working until its keys are entered in settings; any other workspace has no fallback and so never borrows Monarch's keys.
 */
export function resolveKeys(saved: SavedKeys | null, env: Record<string, string | undefined>, isMonarch: boolean): ResolvedKeys {
  const envKey = isMonarch ? env.STRIPE_SECRET_KEY?.trim() || null : null;
  const envHook = isMonarch ? env.STRIPE_WEBHOOK_SECRET?.trim() || null : null;
  const secretKey = saved?.secretKey ?? envKey;
  const webhookSecret = saved?.webhookSecret ?? envHook;
  return {
    secretKey,
    webhookSecret,
    secretKeySource: saved?.secretKey ? "settings" : envKey ? "environment" : null,
    webhookSecretSource: saved?.webhookSecret ? "settings" : envHook ? "environment" : null,
  };
}

/** The owner-facing line for one setting. */
export function describeKey(label: string, source: KeySource, hint: string | null, mode: StripeMode | null): string {
  if (source === "connected") return `${label}: not needed. Your connected Stripe account is used${mode ? ` (${mode} mode)` : ""}; keys saved here stay as a fallback.`;
  if (source === "settings") return `${label}: saved here${hint ? ` (ends ${hint})` : ""}${mode ? `, ${mode} mode` : ""}.`;
  if (source === "environment") return `${label}: still read from the server's environment settings${mode ? ` (${mode} mode)` : ""}. Save it here, check it works, then remove it from Vercel.`;
  return `${label}: not set.`;
}

/** What Stripe said when asked for one of the store's own prices with this key. */
export type PriceLookup = "found" | "missing" | "error";

/**
 * A key can be valid and still belong to the wrong Stripe account (or the other mode), in which case none of the store's
 * prices exist for it and every checkout would fail. Asking for a few of the store's own prices tells these apart.
 */
export function judgeProductLookups(lookups: PriceLookup[]): { ok: boolean; message: string } {
  if (lookups.length === 0) return { ok: true, message: "" };
  if (lookups.some((l) => l === "missing")) {
    return { ok: false, message: "Stripe accepts the key, but it can't find your store's products. This key belongs to a different Stripe account (or the other mode, test or live) than the one your products are in. Use the key from the account that holds them." };
  }
  if (lookups.every((l) => l === "found")) return { ok: true, message: " It also found your store's products." };
  return { ok: true, message: " The key works; your store's products couldn't be checked just now." };
}

// --------------------------------------------------------------- connected account (Stripe Connect)

/** What the workspace's saved Connect connection says (the payment_connections row). */
export type ConnectionFacts = { accountId: string; livemode: boolean; status: "connected" | "disconnected"; chargesEnabled: boolean };

export type ConnectedUse = { usable: true; mode: StripeMode } | { usable: false; note: string | null };

/**
 * Whether the connected account can run the storefront right now. Not usable, it falls back to the saved keys (and then the
 * environment), so a half-finished connection never takes the store down; the note says why, for the owner's screen.
 * `platformMode` is the mode of Verexa's Connect platform key on this deployment, or null when that key is not set.
 */
export function connectedUse(conn: ConnectionFacts | null, platformMode: StripeMode | null): ConnectedUse {
  if (!conn || conn.status !== "connected") return { usable: false, note: null };
  if (!platformMode) return { usable: false, note: "A Stripe account is connected, but this deployment has no Stripe Connect platform key, so it can't be used yet." };
  const mode: StripeMode = conn.livemode ? "live" : "test";
  if (mode !== platformMode) return { usable: false, note: `The connected Stripe account is ${mode}, but this deployment's Stripe Connect platform is ${platformMode}. Connect a ${platformMode} account.` };
  if (!conn.chargesEnabled) return { usable: false, note: "Your Stripe account is connected but can't take payments yet. Finish setting it up in Stripe, then refresh here." };
  return { usable: true, mode };
}

export type StoreResolved = ResolvedKeys & { mode: StripeMode | null; connectedAccount: string | null; connectionNote: string | null };

/**
 * The storefront's Stripe access, in order: the connected account (a usable connection, on Verexa's platform key), then
 * saved keys, then the environment (Monarch only). The webhook signing secret is resolved on its own (saved, then
 * environment) because the connected account's events arrive on the Connect webhook instead.
 */
export function resolveStoreStripe(input: {
  connection: ConnectionFacts | null;
  platformKey: string | null;
  saved: SavedKeys | null;
  env: Record<string, string | undefined>;
  isMonarch: boolean;
}): StoreResolved {
  const keys = resolveKeys(input.saved, input.env, input.isMonarch);
  const use = connectedUse(input.connection, modeOfKey(input.platformKey));
  if (use.usable && input.platformKey && input.connection) {
    return { ...keys, secretKey: input.platformKey, secretKeySource: "connected", mode: use.mode, connectedAccount: input.connection.accountId, connectionNote: null };
  }
  return { ...keys, mode: modeOfKey(keys.secretKey), connectedAccount: null, connectionNote: use.usable ? null : use.note };
}
