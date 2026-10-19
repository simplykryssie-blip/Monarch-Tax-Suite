import "server-only";
import { requireAdmin } from "../admin";
import { requirePractice } from "../practice/server";
import { currentTenantId } from "../tenants.ts";
import { campaignDeps } from "./server";
import type { CampaignDeps } from "./service.ts";
import type { SupabaseCampaignRepo } from "./supabase-repo.ts";

// Who is working on campaigns and for which office. Campaigns appear in the main workspace (the Monarch account) and in an
// independent PTIN holder's workspace. Each area proves who is signed in; everything after that acts as that area's office.

export type CampaignsArea = "admin" | "practice";
export type CampaignsContext = { area: CampaignsArea; base: string; tenantId: string; userId: string; email: string | null; deps: CampaignDeps & { repo: SupabaseCampaignRepo } };

export const isCampaignsArea = (v: unknown): v is CampaignsArea => v === "admin" || v === "practice";

export async function requireCampaigns(area: CampaignsArea): Promise<CampaignsContext> {
  if (area === "admin") {
    const admin = await requireAdmin();
    const tenantId = currentTenantId();
    return { area, base: "/campaigns", tenantId, userId: admin.userId, email: null, deps: campaignDeps(tenantId) };
  }
  const p = await requirePractice();
  return { area, base: "/practice/campaigns", tenantId: p.tenantId, userId: p.userId, email: p.email, deps: campaignDeps(p.tenantId) };
}
