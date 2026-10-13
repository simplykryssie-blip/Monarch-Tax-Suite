import "server-only";
import { createHmac } from "node:crypto";
import { SupabaseCommerceRepo } from "../commerce/supabase-repo.ts";
import { CrmSecrets } from "../crm/crypto.ts";
import { SupabaseDocumentsRepo, SupabaseDocumentStore } from "../documents/supabase-repo.ts";
import { platformClient, tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import { isPublicId, type FormDeps } from "./service.ts";
import { SupabaseFirmsRepo, SupabaseFormsRepo, UPLOAD_BUCKET } from "./supabase-repo.ts";
import { SupabaseSendersRepo } from "../automation/supabase-senders.ts";
import { brandCatalogFrom } from "../brands.ts";

// Server wiring for the Form Builder. Admin pages act for the signed-in tenant; the public form page finds the
// tenant from the form's public id (the only cross-tenant lookup, logged as platform access) and then acts as
// that tenant only.

function masterKey(): Buffer | null {
  const raw = process.env.MONARCH_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function formDeps(tenantId: string = currentTenantId()): FormDeps {
  const master = masterKey();
  const secrets = CrmSecrets.fromBase64(process.env.MONARCH_ENCRYPTION_KEY);
  if (!master || !secrets) throw new Error("MONARCH_ENCRYPTION_KEY is not configured, so form answers cannot be stored securely.");
  const db = tenantClient(tenantId);
  const docs = new SupabaseDocumentsRepo(db);
  const senders = new SupabaseSendersRepo(db);
  return {
    tenantId,
    repo: new SupabaseFormsRepo(db),
    stores: { uploads: new SupabaseDocumentStore(db, UPLOAD_BUCKET), pdfs: new SupabaseDocumentStore(db) },
    firms: new SupabaseFirmsRepo(db),
    commerce: new SupabaseCommerceRepo(db),
    secrets,
    linkKey: createHmac("sha256", master).update("monarch:form-links:v1").digest(),
    profile: () => docs.getProfile().catch(() => null),
    brandCatalog: async () => {
      const [domains, list] = await Promise.all([senders.listDomains(), senders.listSenders()]);
      return brandCatalogFrom(domains, list);
    },
  };
}

/** Which tenant a public form id belongs to, or null. Reads one column of one row. */
export async function tenantForForm(publicId: string): Promise<string | null> {
  if (!isPublicId(publicId)) return null;
  const { data, error } = await platformClient("form_link").from("forms").select("tenant_id").eq("public_id", publicId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.tenant_id as string | undefined) ?? null;
}
