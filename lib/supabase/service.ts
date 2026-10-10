import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, supabaseConfigProblems } from "./config";

/** Service-role Supabase client. Bypasses RLS: server-side only, after an explicit authorization decision. */
export function serviceClient() {
  const problems = supabaseConfigProblems(process.env);
  if (problems.length) throw new Error(`Supabase is not configured: ${problems.join(" ")}`);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
