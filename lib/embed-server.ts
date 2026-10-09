import "server-only";
import { serviceClient } from "./supabase/service";
import { SupabaseCommerceRepo } from "./commerce/supabase-repo.ts";
import { decideEmbed, EMBED_ID_PATTERN, type EmbedDecision } from "./commerce/embed.ts";

/** Looks up an embed id and decides whether the calculator may render for the requesting host. */
export async function loadEmbedDecision(embedId: string | null, requestHost: string | null): Promise<EmbedDecision> {
  if (!embedId || !EMBED_ID_PATTERN.test(embedId)) return decideEmbed(null, [], requestHost);
  const repo = new SupabaseCommerceRepo(serviceClient());
  const license = await repo.findLicenseByEmbedId(embedId);
  const domains = license ? await repo.listDomains(license.id) : [];
  return decideEmbed(license, domains, requestHost);
}
