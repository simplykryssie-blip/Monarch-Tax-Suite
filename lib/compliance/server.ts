import "server-only";
import { appOrigin } from "../admin";
import { senderFor } from "../automation/engine.ts";
import { sanitizeError } from "../automation/sanitize.ts";
import { automationDeps } from "../automation/server";
import { CrmSecrets } from "../crm/crypto.ts";
import { SupabaseDocumentStore, SupabaseDocumentsRepo } from "../documents/supabase-repo.ts";
import { heldBack } from "../forms/after.ts";
import type { OfficeContext } from "../office/server";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import type { ComplianceDeps, Ctx } from "./service.ts";
import { SupabaseComplianceRepo } from "./supabase-repo.ts";

// Server wiring for the Compliance Center. The office area acts for the signed-in member's tenant and office; the
// bureau's status page and the reminder sweep act for the current tenant. Files go to the private tenant-documents
// bucket under {tenant_id}/compliance/{office}/.

export function complianceDeps(tenantId: string = currentTenantId()): ComplianceDeps {
  const db = tenantClient(tenantId);
  return {
    tenantId,
    repo: new SupabaseComplianceRepo(db),
    store: new SupabaseDocumentStore(db),
    secrets: CrmSecrets.fromBase64(process.env.MONARCH_ENCRYPTION_KEY),
    origin: appOrigin,
    send: async (mail) => {
      const auto = automationDeps(tenantId);
      if (auto.config.env !== "production" && !auto.config.testRecipients.map((r) => r.toLowerCase()).includes(mail.to.toLowerCase())) return heldBack(auto, mail.to);
      let sender;
      try {
        sender = await senderFor(auto, null);
      } catch (e) {
        return sanitizeError(e, 200);
      }
      const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
      const html = mail.text.split("\n").map((l) => (/^https?:\/\//.test(l) ? `<p><a href="${esc(l)}">${esc(l)}</a></p>` : l ? `<p>${esc(l)}</p>` : "")).join("");
      const result = await auto.email.send({ ...sender, to: mail.to, subject: mail.subject, text: mail.text, html, idempotencyKey: mail.idempotencyKey });
      return result.ok ? null : sanitizeError(result.message, 200);
    },
  };
}

/** The Compliance Center's view of who is acting in the office area. */
export function ctxFor(office: OfficeContext): Ctx {
  return {
    userId: office.userId, name: office.member?.full_name ?? office.email, role: office.role, memberId: office.member?.id ?? null,
    permissions: office.permissions, officeId: office.office.id, officeName: office.office.name,
  };
}

/** The name the tenant's documents carry (its firm profile), for the WISP PDF footer. */
export async function brandName(tenantId: string): Promise<string> {
  const profile = await new SupabaseDocumentsRepo(tenantClient(tenantId)).getProfile().catch(() => null);
  return profile?.display_name || "Monarch Tax Suite";
}
