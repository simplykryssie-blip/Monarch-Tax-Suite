import { SitesOverview } from "@/components/sites/views";
import { requireSites } from "@/lib/sites/context";

export default async function Page({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  return <SitesOverview ctx={await requireSites("practice")} sp={await searchParams} />;
}
