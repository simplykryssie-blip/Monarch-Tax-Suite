import "server-only";
import { randomUUID } from "node:crypto";
import { commerceRepo, tenantDb } from "../admin";
import { audit as efinAudit } from "../efin/service.ts";
import { leadsDeps } from "../leads/server";
import { visibleClients } from "../prep/service.ts";
import type { PrepContext } from "../prep/server";
import { workspaceRepo } from "../workspace/load";
import { clientsTarget, customersTarget, firmsTarget, leadsTarget, type FirmsPort } from "./targets.ts";
import type { Destination } from "./contacts.ts";
import type { ImportTarget } from "./service.ts";

// Wires each import destination to the signed-in account's own data. Only called after the caller has been checked for
// that destination (see app/import-actions.ts), and every query runs as the current tenant.

/** The PTIN workspace and the office area: clients only, owned by the person importing and scoped to their office. */
export function prepTarget(ctx: PrepContext): ImportTarget {
  return clientsTarget(ctx.deps.ws, { userId: ctx.userId, organizationId: ctx.scope.organizationId, visible: () => visibleClients(ctx.deps, ctx.scope) });
}

/** The main account's admin area, for any destination its tier allows. */
export function adminTarget(destination: Destination, who: { userId: string; email: string }): ImportTarget {
  switch (destination) {
    case "clients": { const ws = workspaceRepo(); return clientsTarget(ws, { userId: who.userId, organizationId: null, visible: () => ws.listClients({ includeArchived: false }) }); }
    case "leads": return leadsTarget(leadsDeps().repo, { userId: who.userId });
    case "customers": return customersTarget(commerceRepo());
    case "firms": return firmsTarget(firmsPort(who), { userId: who.userId });
  }
}

function firmsPort(who: { userId: string; email: string }): FirmsPort {
  const db = tenantDb();
  return {
    async listFirms() {
      const { data, error } = await db.from("organizations").select("id, legal_name, notes").limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; legal_name: string; notes: string | null }[];
    },
    async insertFirm(input) {
      const id = randomUUID();
      // A partner with no agreement yet and no EFIN; the rest is filled in on the firm's own page.
      const { error } = await db.from("organizations").insert({ id, kind: "partner", relationship: "other", ...input, updated_by: input.created_by });
      if (error) throw new Error(error.message);
      return { id };
    },
    async setNotes(id, notes) {
      const { error } = await db.from("organizations").update({ notes }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    async recordCreated(id) {
      await efinAudit({ id: who.userId, email: who.email }, { type: "organization_imported", targetType: "organization", targetId: id, organizationId: id, changes: { source: "import" } });
    },
  };
}
