import "server-only";
import { leadsDeps } from "../leads/server";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import { workspaceRepo } from "../workspace/server";
import type { PersonRef, RelKind, Relationship, RelationshipsDeps, RelationshipsRepo } from "./relationships.ts";

type Row = { id: string; a_client_id: string | null; a_lead_id: string | null; b_client_id: string | null; b_lead_id: string | null; kind: RelKind; note: string | null; created_at: string };

function unwrap<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}
const ref = (client: string | null, lead: string | null): PersonRef => (client ? { kind: "client", id: client } : { kind: "lead", id: lead! });
const shape = (r: Row): Relationship => ({ id: r.id, a: ref(r.a_client_id, r.a_lead_id), b: ref(r.b_client_id, r.b_lead_id), kind: r.kind, note: r.note, created_at: r.created_at });
const cols = (side: "a" | "b", p: PersonRef) => (p.kind === "client" ? { [`${side}_client_id`]: p.id } : { [`${side}_lead_id`]: p.id });

export function relationshipsRepo(tenantId: string = currentTenantId()): RelationshipsRepo {
  const db = () => tenantClient(tenantId);
  return {
    async listFor(p) {
      const col = p.kind === "client" ? "client_id" : "lead_id";
      const rows = unwrap(await db().from("contact_relationships").select("*").or(`a_${col}.eq.${p.id},b_${col}.eq.${p.id}`).order("created_at").limit(100)) as Row[];
      return rows.map(shape);
    },
    async get(id) { const r = unwrap(await db().from("contact_relationships").select("*").eq("id", id).maybeSingle()) as Row | null; return r ? shape(r) : null; },
    async add(a, b, kind, note, actorId) {
      return shape(unwrap(await db().from("contact_relationships").insert({ ...cols("a", a), ...cols("b", b), kind, note, created_by: actorId }).select("*").single()) as Row);
    },
    async remove(id) { unwrap(await db().from("contact_relationships").delete().eq("id", id).select("id")); },
  };
}

export const relationshipsDeps = (): RelationshipsDeps => ({ rels: relationshipsRepo(), clients: workspaceRepo(), leads: leadsDeps().repo });
