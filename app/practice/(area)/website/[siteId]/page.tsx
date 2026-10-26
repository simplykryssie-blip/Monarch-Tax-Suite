import { SitesOverview } from "@/components/sites/views";
import { requireSite } from "@/lib/sites/context";

export default async function Page({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  return <SitesOverview ctx={await requireSite("practice", (await params).siteId)} sp={await searchParams} />;
}
