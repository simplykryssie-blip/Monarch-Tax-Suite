import "server-only";
import { SupabaseDocumentStore } from "../documents/supabase-repo.ts";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import type { LeadDoc, LeadDocsDb, LeadDocsDeps } from "./docs.ts";

const unwrap = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

/** Lead documents for one tenant, on its own scoped client: row-level security limits every call to that tenant's rows. */
export function leadDocsDeps(tenantId: string = currentTenantId()): LeadDocsDeps {
  const db = tenantClient(tenantId);
  const rows: LeadDocsDb = {
    async listLeadDocs(leadId) { return unwrap(await db.from("lead_docs").select("*").eq("lead_id", leadId).eq("status", "stored").order("created_at", { ascending: false })) as LeadDoc[]; },
    async getLeadDoc(id) { return unwrap(await db.from("lead_docs").select("*").eq("id", id).maybeSingle()) as LeadDoc | null; },
    async deleteLeadDoc(id) { unwrap(await db.from("lead_docs").delete().eq("id", id)); },
    async clientHasSubmissionDoc(submissionId) { return !!unwrap(await db.from("client_docs").select("id").eq("form_submission_id", submissionId).maybeSingle()); },
    async insertClientDoc(input) {
      unwrap(await db.from("client_docs").insert({ ...input, status: "stored", source: "staff", shared_with_client: false }));
    },
  };
  return { tenantId, db: rows, files: new SupabaseDocumentStore(db) };
}

/** Moves a lead's documents to the client it became, without ever stopping the conversion itself. Returns how many moved. */
export async function moveLeadDocs(leadId: string, clientId: string): Promise<number> {
  const { moveLeadDocsToClient } = await import("./docs.ts");
  try {
    return await moveLeadDocsToClient(leadDocsDeps(), leadId, clientId);
  } catch (e) {
    console.error(`lead documents did not move (lead ${leadId} to client ${clientId}): ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    return 0;
  }
}
