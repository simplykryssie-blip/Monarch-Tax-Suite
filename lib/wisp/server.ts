import "server-only";
import { headers } from "next/headers";
import { appOrigin } from "../admin";
import { senderFor } from "../automation/engine.ts";
import { sanitizeError } from "../automation/sanitize.ts";
import { automationDeps } from "../automation/server";
import { SupabaseSendersRepo } from "../automation/supabase-senders.ts";
import { brandsOf, hostFromHeaders } from "../brands.ts";
import { CrmSecrets } from "../crm/crypto.ts";
import { SupabaseDocumentStore, SupabaseDocumentsRepo } from "../documents/supabase-repo.ts";
import { heldBack } from "../forms/after.ts";
import { platformClient, tenantClient } from "../supabase/service";
import { MONARCH_TENANT_ID } from "../tenants.ts";
import { convertFromPurchase } from "../leads/service.ts";
import { leadsDeps } from "../leads/server";
import type { WispDeps } from "./service.ts";
import { SupabaseWispRepo } from "./supabase-repo.ts";

// Server wiring for the WISP Generator. The public page belongs to the tenant whose brand web address it was opened
// on (Monarch for the app's own address); everything after that acts as that tenant only.

/** The tenant whose brand owns this web address, or Monarch. One indexed lookup, logged as platform access. */
export async function tenantForHost(host: string | null): Promise<string> {
  if (!host) return MONARCH_TENANT_ID;
  const bare = host.replace(/:\d+$/, "");
  const { data } = await platformClient("wisp_link").from("email_domains").select("tenant_id").eq("link_host", bare).maybeSingle();
  if (data?.tenant_id) return data.tenant_id as string;
  // An office's website address also names the office, so booking pages and forms embedded in its site work on it.
  const site = await platformClient("site_host").from("site_domains").select("tenant_id").eq("hostname", bare).maybeSingle();
  return (site.data?.tenant_id as string | undefined) ?? MONARCH_TENANT_ID;
}

export async function requestTenant(): Promise<string> {
  return tenantForHost(hostFromHeaders(await headers()));
}

export function wispDeps(tenantId: string): WispDeps {
  const secrets = CrmSecrets.fromBase64(process.env.MONARCH_ENCRYPTION_KEY);
  if (!secrets) throw new Error("MONARCH_ENCRYPTION_KEY is not configured, so WISP answers cannot be stored securely.");
  const db = tenantClient(tenantId);
  const senders = new SupabaseSendersRepo(db);
  const brand = async () => {
    const [domains, profile] = await Promise.all([senders.listDomains().catch(() => []), new SupabaseDocumentsRepo(db).getProfile().catch(() => null)]);
    const brands = brandsOf(domains);
    const only = brands.length === 1 ? brands[0] : null;
    const name = only?.name ?? profile?.display_name ?? "Your office";
    const origin = process.env.VERCEL_ENV === "production" && only?.linkHost ? `https://${only.linkHost}` : await appOrigin();
    return { name, origin };
  };
  return {
    tenantId,
    repo: new SupabaseWispRepo(db),
    store: new SupabaseDocumentStore(db),
    secrets,
    brand,
    onPaid: (plan) => plan.customer_id && plan.order_id
      ? convertFromPurchase(leadsDeps(tenantId), { auditId: plan.audit_id, email: plan.email, planId: plan.id, customerId: plan.customer_id, orderId: plan.order_id })
      : Promise.resolve(null),
    send: async (mail) => {
      const auto = automationDeps(tenantId);
      if (auto.config.env !== "production" && !auto.config.testRecipients.map((r) => r.toLowerCase()).includes(mail.to.toLowerCase())) return heldBack(auto, mail.to);
      let sender;
      try {
        sender = await senderFor(auto, null);
      } catch (e) {
        return sanitizeError(e, 200);
      }
      const result = await auto.email.send({ ...sender, ...mail });
      return result.ok ? null : sanitizeError(result.message, 200);
    },
  };
}
