import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { requireAdmin, requirePlatformAdmin, tenantDb } from "./admin";
import { allows, homeFor, isTier, type Section, type Tier } from "./tier.ts";

/**
 * The signed-in account's tier. If the tier column isn't there yet (the migration hasn't run) or can't be read, the
 * account is treated as Service Bureau, so a deploy that lands before the migration never hides anything.
 */
export const currentTier = cache(async (): Promise<Tier> => {
  try {
    const { data, error } = await tenantDb().from("tenants").select("tier").limit(1).maybeSingle();
    if (error) return "bureau";
    const tier = (data as { tier?: unknown } | null)?.tier;
    return isTier(tier) ? tier : "bureau";
  } catch {
    return "bureau";
  }
});

/** Page guard: administrators only, and only if their tier includes this section. Otherwise they go to their own home. */
export async function requireSection(section: Section) {
  // The platform Admin area is for platform administrators only, whatever tier the account is on.
  if (section === "platform") return { ...(await requirePlatformAdmin()), tier: await currentTier() };
  const admin = await requireAdmin();
  const tier = await currentTier();
  if (!allows(tier, section)) redirect(homeFor());
  return { ...admin, tier };
}
