import { DomainsView } from "@/components/sites/views";
import { requireSite } from "@/lib/sites/context";

export default async function Page({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  return <DomainsView ctx={await requireSite("admin", (await params).siteId)} sp={await searchParams} />;
}
