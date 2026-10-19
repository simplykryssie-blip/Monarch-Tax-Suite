import { notFound } from "next/navigation";
import { CampaignEditor, CampaignResults } from "@/components/campaigns/views";
import { requireCampaigns } from "@/lib/campaigns/context";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string; view?: string }> }) {
  const { id } = await params;
  const ctx = await requireCampaigns("practice");
  const c = /^[0-9a-f-]{36}$/i.test(id) ? await ctx.deps.repo.getCampaign(id) : null;
  if (!c) notFound();
  const sp = await searchParams;
  return c.status === "draft" ? <CampaignEditor ctx={ctx} c={c} sp={sp} /> : <CampaignResults ctx={ctx} c={c} sp={sp} />;
}
