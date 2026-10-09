// Monarch Tax Suite's Supabase settings. Deployment environment variables take
// precedence. The production project URL is used as a fallback only on the
// production deployment: previews and local runs must name their own (test)
// project explicitly, so they can never reach production by omission.

export const PRODUCTION_SUPABASE_REF = "ftthniovwzxztkwtregz";
const PRODUCTION_SUPABASE_URL = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`;

type Env = Record<string, string | undefined>;

/** The URL this deployment should use, or "" when it is not configured. */
export function resolveSupabaseUrl(env: Env): string {
  return env.NEXT_PUBLIC_SUPABASE_URL || (env.VERCEL_ENV === "production" ? PRODUCTION_SUPABASE_URL : "");
}

/**
 * Configuration problems that make the app unable to run safely, as messages
 * that name variables but never include their values. Empty = OK.
 */
export function supabaseConfigProblems(env: Env): string[] {
  const problems: string[] = [];
  const url = resolveSupabaseUrl(env);
  if (!url) problems.push("NEXT_PUBLIC_SUPABASE_URL is not set for this environment.");
  if (!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) problems.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set for this environment.");
  // Preview deployments must use an isolated test project, never production.
  if (env.VERCEL_ENV === "preview" && url.includes(PRODUCTION_SUPABASE_REF)) {
    problems.push("NEXT_PUBLIC_SUPABASE_URL points to the production project; Preview must use the test project.");
  }
  return problems;
}

export const SUPABASE_URL = resolveSupabaseUrl(process.env);
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
