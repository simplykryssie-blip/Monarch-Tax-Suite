import "server-only";
import { serviceClient } from "./supabase/service";
import type { RateLimitStore } from "./commerce/rate-limit.ts";

/** Postgres-backed counters (see migration 20261009200000_rate_limit_counters). Throws when the counter store is unavailable. */
export function rateLimitStore(): RateLimitStore {
  return {
    async hit(bucket, windowStartIso) {
      const { data, error } = await serviceClient().rpc("hit_rate_limit", { p_bucket: bucket, p_window_start: windowStartIso });
      if (error) throw new Error(error.code ?? "rpc_failed");
      return Number(data);
    },
  };
}
