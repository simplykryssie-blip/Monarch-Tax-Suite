// The public origin links should use, from the deployment's environment. Production (and local runs with
// NEXT_PUBLIC_APP_URL) use the configured domain; Preview uses its own deployment address, so links made on a
// preview open on that preview instead of the production domain. Null: fall back to the request's host.
export function configuredOrigin(env: Record<string, string | undefined>): string | null {
  const configured = env.NEXT_PUBLIC_APP_URL;
  if (configured && env.VERCEL_ENV !== "preview") return configured.replace(/\/$/, "");
  const preview = env.VERCEL_ENV === "preview" ? env.VERCEL_BRANCH_URL || env.VERCEL_URL : null;
  return preview ? `https://${preview.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : null;
}
