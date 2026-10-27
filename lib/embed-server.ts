import "server-only";
import { tenantDb } from "./admin";
import { SupabaseCommerceRepo } from "./commerce/supabase-repo.ts";
import { decideEmbed, embedIdVariants, EMBED_ID_PATTERN, type EmbedDecision } from "./commerce/embed.ts";
import { licensedYears } from "./commerce/versions.ts";

/** Looks up an embed id and decides whether the calculator may render for the requesting host. */
export async function loadEmbedDecision(embedId: string | null, requestHost: string | null): Promise<EmbedDecision> {
  return (await loadEmbed(embedId, requestHost)).decision;
}

/** Decision plus the tax years the license may use (its licensed version and earlier). */
export async function loadEmbed(embedId: string | null, requestHost: string | null): Promise<{ decision: EmbedDecision; years: number[]; licenseId: string | null }> {
  if (!embedId || !EMBED_ID_PATTERN.test(embedId)) return { decision: decideEmbed(null, [], requestHost), years: [], licenseId: null };
  const repo = new SupabaseCommerceRepo(tenantDb());
  let license = await repo.findLicenseByEmbedId(embedId);
  // A look-alike character copied wrongly (a "1" for an "l") still finds the customer's calculator.
  if (!license) for (const v of embedIdVariants(embedId)) { license = await repo.findLicenseByEmbedId(v); if (license) break; }
  const domains = license ? await repo.listDomains(license.id) : [];
  return { decision: decideEmbed(license, domains, requestHost), years: license ? licensedYears(license) : [], licenseId: license?.id ?? null };
}
