import "server-only";
import { leadsDeps } from "../leads/server";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import { workspaceRepo } from "../workspace/server";
import type { ContactMethod, MethodOwner, MethodsDeps, MethodsRepo } from "./methods.ts";

function unwrap<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export function methodsRepo(tenantId: string = currentTenantId()): MethodsRepo {
  const db = () => tenantClient(tenantId);
  const col = (o: MethodOwner) => (o.kind === "client" ? "client_id" : "lead_id");
  return {
    async list(owner) { return unwrap(await db().from("contact_methods").select("*").eq(col(owner), owner.id).order("created_at")) as ContactMethod[]; },
    async get(id) { return unwrap(await db().from("contact_methods").select("*").eq("id", id).maybeSingle()) as ContactMethod | null; },
    async add(owner, input, actorId) {
      return unwrap(await db().from("contact_methods").insert({ [col(owner)]: owner.id, ...input, created_by: actorId }).select("*").single()) as ContactMethod;
    },
    async remove(id) { unwrap(await db().from("contact_methods").delete().eq("id", id).select("id")); },
  };
}

export const methodsDeps = (): MethodsDeps => ({ methods: methodsRepo(), clients: workspaceRepo(), leads: leadsDeps().repo });
