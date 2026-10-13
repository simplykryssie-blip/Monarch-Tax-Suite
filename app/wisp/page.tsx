import type { Metadata } from "next";
import { stripeClient } from "@/lib/admin";
import { LEGAL_PAGES_APPROVED } from "@/lib/legal";
import { MONARCH_TENANT_ID } from "@/lib/tenants";
import { SupabaseCommerceRepo } from "@/lib/commerce/supabase-repo.ts";
import { tenantClient } from "@/lib/supabase/service";
import { comparisonFee } from "@/lib/wisp/content.ts";
import { requestTenant, wispDeps } from "@/lib/wisp/server";
import { WispApp } from "@/components/wisp/wisp-app";

export const metadata: Metadata = {
  title: "WISP Generator: free audit and guided Written Information Security Plan",
  description: "The IRS requires every tax preparer to have a Written Information Security Plan. Take the free 2-minute audit, then build your attorney-ready WISP for $25.",
};

/** The public WISP Generator. Its brand is the brand whose web address it was opened on. */
export default async function WispPage({ searchParams }: { searchParams: Promise<{ cancelled?: string }> }) {
  const { cancelled } = await searchParams;
  const tenantId = await requestTenant().catch(() => MONARCH_TENANT_ID);
  const brandName = await (async () => {
    try { return (await wispDeps(tenantId).brand()).name; } catch { return "Monarch Tax Suite"; }
  })();
  // Payment runs through the Monarch storefront's Stripe account, so only Monarch's builder can take it today.
  const canBuy = tenantId === MONARCH_TENANT_ID && LEGAL_PAGES_APPROVED && !!stripeClient();
  // The comparison uses the firm's own fee (the WISP product's "comparison_fee" setting); none set, none shown.
  const ourFee = await new SupabaseCommerceRepo(tenantClient(tenantId)).listProducts()
    .then((list) => comparisonFee(list.find((p) => p.metadata?.delivery === "wisp_generator" && p.status !== "archived")?.metadata))
    .catch(() => null);
  return <WispApp brandName={brandName} canBuy={canBuy} cancelled={cancelled === "1"} ourFee={ourFee} />;
}
