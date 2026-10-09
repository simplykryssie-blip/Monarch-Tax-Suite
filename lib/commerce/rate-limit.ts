import { createHash, createHmac } from "node:crypto";

// Durable, fixed-window rate limiting for public endpoints. Counters live in
// Postgres (not process memory) so they survive serverless cold starts and are
// shared by every instance. Only a keyed hash of the client address is stored,
// never the address itself, and counter rows are pruned after a day.

export const WINDOW_SECONDS = 60;
/** Requests per client address per window. Generous: legitimate use is a handful of checks per page load. */
export const LIMIT_PER_CLIENT = 60;
/** Requests per embed id per window across all clients, so shared office networks are not starved by one noisy visitor. */
export const LIMIT_PER_EMBED = 600;

export type RateLimitStore = {
  /** Atomically increments the counter for (bucket, window start) and returns the new count. */
  hit(bucket: string, windowStartIso: string): Promise<number>;
};

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number; scope: "client" | "embed" };

export function windowStart(nowMs: number): { startIso: string; retryAfterSeconds: number } {
  const size = WINDOW_SECONDS * 1000;
  const start = Math.floor(nowMs / size) * size;
  return { startIso: new Date(start).toISOString(), retryAfterSeconds: Math.max(1, Math.ceil((start + size - nowMs) / 1000)) };
}

/** Keyed hash of a client address. Falls back to a plain hash when no key is configured. */
export function hashClient(ip: string, key?: string | null): string {
  return key ? createHmac("sha256", `rate-limit:${key}`).update(ip).digest("hex") : createHash("sha256").update(`rate-limit:${ip}`).digest("hex");
}

/** First address of x-forwarded-for (set by the hosting platform), or null. */
export function clientAddress(forwardedFor: string | null | undefined): string | null {
  const first = forwardedFor?.split(",")[0]?.trim();
  return first && first.length <= 64 ? first : null;
}

/**
 * Counts one request and decides whether it may proceed. If the store fails,
 * the request is allowed (a counter outage must not take down legitimate
 * calculators) and `onError` is told so the failure can be logged by code only.
 */
export async function checkRate(
  store: RateLimitStore,
  input: { clientHash: string | null; embedId: string | null; nowMs?: number; onError?: (reason: string) => void },
): Promise<RateDecision> {
  const { startIso, retryAfterSeconds } = windowStart(input.nowMs ?? Date.now());
  try {
    if (input.clientHash && (await store.hit(`validate:ip:${input.clientHash}`, startIso)) > LIMIT_PER_CLIENT) {
      return { allowed: false, retryAfterSeconds, scope: "client" };
    }
    if (input.embedId && (await store.hit(`validate:embed:${input.embedId}`, startIso)) > LIMIT_PER_EMBED) {
      return { allowed: false, retryAfterSeconds, scope: "embed" };
    }
  } catch {
    input.onError?.("rate_limit_store_unavailable");
  }
  return { allowed: true };
}
