// Monarch Tax Suite's dedicated Supabase project. Never fall back to another
// project's URL or key; deployment environment variables take precedence.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://ftthniovwzxztkwtregz.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
