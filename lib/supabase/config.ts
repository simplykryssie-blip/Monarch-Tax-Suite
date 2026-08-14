// The Supabase URL and publishable/anon key are not secrets -- they're meant
// to ship in client-side bundles (actual access control is enforced by RLS).
// Falling back to the real values here means the app works out of the box
// on a fresh deploy even before NEXT_PUBLIC_* env vars are configured there.

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://daxpavvsotvsyqqntddc.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_uCNPHUlDe-6aGabPz2jvew_AS9TyPop";
