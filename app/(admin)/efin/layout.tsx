import { requireSection } from "@/lib/tier-server";

// An ERO adds and manages its own firm here; the downline-wide views (dashboard, registry, renewals, export) are the Service Bureau's and check that themselves (see lib/tier.ts).
export default async function EfinLayout({ children }: { children: React.ReactNode }) {
  await requireSection("ero");
  return <>{children}</>;
}
