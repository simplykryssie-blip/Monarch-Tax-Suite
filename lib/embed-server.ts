import "server-only";
import { serviceClient } from "./supabase/service";
import { SupabaseCommerceRepo } from "./commerce/supabase-repo.ts";
import { decideEmbed, EMBED_ID_PATTERN, type EmbedDecision } from "./commerce/embed.ts";
import { licensedYears } from "./commerce/versions.ts";

/** Looks up an embed id and decides whether the calculator may render for the requesting host. */
export async function loadEmbedDecision(embedId: string | null, requestHost: string | null): Promise<EmbedDecision> {
  return (await loadEmbed(embedId, requestHost)).decision;
}

/** Decision plus the tax years the license may use (its licensed version and earlier). */
export async function loadEmbed(embedId: string | null, requestHost: string | null): Promise<{ decision: EmbedDecision; years: number[] }> {
  if (!embedId || !EMBED_ID_PATTERN.test(embedId)) return { decision: decideEmbed(null, [], requestHost), years: [] };
  const repo = new SupabaseCommerceRepo(serviceClient());
  const license = await repo.findLicenseByEmbedId(embedId);
  const domains = license ? await repo.listDomains(license.id) : [];
  return { decision: decideEmbed(license, domains, requestHost), years: license ? licensedYears(license) : [] };
}
