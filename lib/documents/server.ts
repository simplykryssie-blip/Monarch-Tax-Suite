import "server-only";
import { createHmac } from "node:crypto";
import { platformClient, tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import { hashLinkToken, type DocumentDeps } from "./service.ts";
import { SupabaseDocumentStore, SupabaseDocumentsRepo } from "./supabase-repo.ts";

// Server wiring for document management. Admin pages act for the signed-in tenant; public link pages find the
// tenant from the link itself (the only cross-tenant lookup, logged as platform access) and then act as that tenant.

/** The secret behind secure document links, derived from MONARCH_ENCRYPTION_KEY. Null when it is not configured. */
export function documentLinkKey(): Buffer | null {
  const raw = process.env.MONARCH_ENCRYPTION_KEY;
  if (!raw) return null;
  const master = Buffer.from(raw, "base64");
  if (master.length !== 32) return null;
  return createHmac("sha256", master).update("monarch:document-links:v1").digest();
}

export function documentDeps(tenantId: string = currentTenantId()): DocumentDeps {
  const linkKey = documentLinkKey();
  if (!linkKey) throw new Error("MONARCH_ENCRYPTION_KEY is not configured, so secure document links cannot be made.");
  const db = tenantClient(tenantId);
  return { tenantId, repo: new SupabaseDocumentsRepo(db), store: new SupabaseDocumentStore(db), linkKey };
}

/** Which tenant a secure link belongs to, or null. Reads one column of one row by the token's hash. */
export async function tenantForLink(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const { data, error } = await platformClient("document_link").from("document_deliveries").select("tenant_id").eq("token_hash", hashLinkToken(token)).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.tenant_id as string | undefined) ?? null;
}
