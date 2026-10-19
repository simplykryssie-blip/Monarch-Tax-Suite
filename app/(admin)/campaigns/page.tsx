import { CampaignsHome } from "@/components/campaigns/views";
import { requireCampaigns } from "@/lib/campaigns/context";

export default async function Page({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  return <CampaignsHome ctx={await requireCampaigns("admin")} sp={await searchParams} />;
}
