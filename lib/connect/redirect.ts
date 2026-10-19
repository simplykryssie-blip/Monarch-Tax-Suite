import "server-only";
import { appOrigin } from "../admin";

/**
 * Where Stripe sends the person back after they authorize. It must match the redirect registered on the platform's
 * Connect settings exactly. STRIPE_CONNECT_REDIRECT_BASE names it (for example the Verexa HQ address); without it the
 * deployment's own address is used (Preview and local testing).
 */
export async function connectRedirectUri(): Promise<string> {
  const base = (process.env.STRIPE_CONNECT_REDIRECT_BASE || (await appOrigin())).replace(/\/$/, "");
  return `${base}/api/stripe/connect/callback`;
}
