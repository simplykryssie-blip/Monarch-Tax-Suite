// Stripe Connect settings. The Connect platform is Verexa HQ's Stripe account, so these are separate from the
// STRIPE_SECRET_KEY the storefront uses. Names only here; the values live in the host's environment settings.

export type ConnectEnv = Record<string, string | undefined>;

export function connectMode(key: string | undefined): "live" | "test" | null {
  if (!key) return null;
  if (/^(sk|rk)_live_/.test(key)) return "live";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  return null;
}

/** What is missing for online payments, in plain words (never the values). */
export function connectProblems(env: ConnectEnv): string[] {
  const problems: string[] = [];
  if (!env.STRIPE_CONNECT_SECRET_KEY) problems.push("STRIPE_CONNECT_SECRET_KEY (Verexa HQ's Stripe secret key) is not set.");
  else if (!connectMode(env.STRIPE_CONNECT_SECRET_KEY)) problems.push("STRIPE_CONNECT_SECRET_KEY isn't a Stripe secret key.");
  if (!env.STRIPE_CONNECT_CLIENT_ID) problems.push("STRIPE_CONNECT_CLIENT_ID (the platform's ca_… client id) is not set.");
  else if (!/^ca_[A-Za-z0-9]+$/.test(env.STRIPE_CONNECT_CLIENT_ID)) problems.push("STRIPE_CONNECT_CLIENT_ID should look like ca_….");
  if (!env.STRIPE_CONNECT_WEBHOOK_SECRET) problems.push("STRIPE_CONNECT_WEBHOOK_SECRET (the Connect webhook's signing secret) is not set.");
  return problems;
}
