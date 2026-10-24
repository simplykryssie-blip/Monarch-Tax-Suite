import "server-only";
import { createClient as createBareClient } from "@supabase/supabase-js";
import { rateLimitStore } from "../rate-limit-server";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../supabase/config";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import { Keyring } from "./keyring.ts";
import { REVEAL_LIMIT, REVEAL_WINDOW_SECONDS, type RevealGate, type SsnDeps } from "./service.ts";
import { SupabaseSsnRepo } from "./supabase-repo.ts";

export function ssnDeps(tenantId: string = currentTenantId()): SsnDeps {
  return { tenantId, keyring: Keyring.fromEnv(process.env), repo: new SupabaseSsnRepo(tenantClient(tenantId), tenantId) };
}

/** Re-checks a password without touching the signed-in session: a separate, throwaway sign-in. */
async function passwordMatches(email: string, password: string): Promise<boolean> {
  const bare = createBareClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await bare.auth.signInWithPassword({ email, password });
  if (data.session) await bare.auth.signOut().catch(() => undefined);
  return !error && !!data.user;
}

/** Call only after requireAdmin() has confirmed this person works in the workspace: that is what `isMember` records. */
export async function revealGate(who: { userId: string; email: string }, tenantId: string = currentTenantId()): Promise<RevealGate> {
  return {
    actorId: who.userId,
    isMember: true,
    verifyPassword: (password) => passwordMatches(who.email, password),
    async allowAttempt() {
      const size = REVEAL_WINDOW_SECONDS * 1000;
      const start = new Date(Math.floor(Date.now() / size) * size).toISOString();
      try { return (await rateLimitStore().hit(`ssn-reveal:${tenantId}:${who.userId}`, start)) <= REVEAL_LIMIT; } catch { return false; } // fail closed
    },
  };
}
