import { ContactsView } from "@/components/campaigns/views";
import { requireCampaigns } from "@/lib/campaigns/context";

export default async function Page({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; q?: string; kind?: string }> }) {
  return <ContactsView ctx={await requireCampaigns("practice")} sp={await searchParams} />;
}
