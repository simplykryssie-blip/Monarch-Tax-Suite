import { DomainsView } from "@/components/sites/views";
import { requireSites } from "@/lib/sites/context";

export default async function Page({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  return <DomainsView ctx={await requireSites("practice")} sp={await searchParams} />;
}
