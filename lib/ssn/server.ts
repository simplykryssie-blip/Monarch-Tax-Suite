import "server-only";
import { createClient as createBareClient } from "@supabase/supabase-js";
import { isAdminUser } from "../admin";
import { rateLimitStore } from "../rate-limit-server";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../supabase/config";
import { tenantClient } from "../supabase/service";
import { currentTenantId, MONARCH_TENANT_ID } from "../tenants.ts";
import { Keyring } from "./keyring.ts";
import { REVEAL_LIMIT, REVEAL_WINDOW_SECONDS, type RevealGate, type SsnDeps } from "./service.ts";
import { SupabaseSsnRepo } from "./supabase-repo.ts";

export function ssnDeps(tenantId: string = currentTenantId()): SsnDeps {
  return { tenantId, keyring: Keyring.fromEnv(process.env), repo: new SupabaseSsnRepo(tenantClient(tenantId), tenantId) };
}

/** The account owner of a workspace: the Monarch administrator for the platform's own tenant, the ERO of an office, the owner of a PTIN workspace. */
export async function isAccountOwner(userId: string, tenantId: string): Promise<boolean> {
  if (tenantId === MONARCH_TENANT_ID) return isAdminUser(userId);
  const db = tenantClient(tenantId);
  const [ero, holder] = await Promise.all([
    db.from("office_members").select("id").eq("user_id", userId).eq("role", "ero").eq("status", "active").maybeSingle(),
    db.from("practice_members").select("id").eq("user_id", userId).eq("role", "owner").eq("status", "active").maybeSingle(),
  ]);
  return !!ero.data || !!holder.data;
}

/** Re-checks a password without touching the signed-in session: a separate, throwaway sign-in. */
async function passwordMatches(email: string, password: string): Promise<boolean> {
  const bare = createBareClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await bare.auth.signInWithPassword({ email, password });
  if (data.session) await bare.auth.signOut().catch(() => undefined);
  return !error && !!data.user;
}

export async function revealGate(who: { userId: string; email: string }, tenantId: string = currentTenantId()): Promise<RevealGate> {
  return {
    actorId: who.userId,
    isOwner: await isAccountOwner(who.userId, tenantId),
    verifyPassword: (password) => passwordMatches(who.email, password),
    async allowAttempt() {
      const size = REVEAL_WINDOW_SECONDS * 1000;
      const start = new Date(Math.floor(Date.now() / size) * size).toISOString();
      try { return (await rateLimitStore().hit(`ssn-reveal:${tenantId}:${who.userId}`, start)) <= REVEAL_LIMIT; } catch { return false; } // fail closed
    },
  };
}
