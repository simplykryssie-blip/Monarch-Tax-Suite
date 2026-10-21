import { ValidationError } from "../commerce/validation.ts";
import type { PrepDeps, Scope } from "../prep/types.ts";
import { IMPORT_MAX_BYTES, planContactImport, type ContactImportPlan } from "./contacts.ts";

// Importing clients into the account or office the person works in. A first call shows what would happen; a second, with
// confirm, does it. Imported people are NOT marked as having agreed to marketing emails or texts: consent is a separate
// step in Campaigns, and an import never grants it.

export type ImportOutcome = { plan: ContactImportPlan; added: number; failed: number; done: boolean };

export async function importClients(deps: PrepDeps, scope: Scope, input: { csv: string; tag: string; confirm: boolean }): Promise<ImportOutcome> {
  if (input.csv.length > IMPORT_MAX_BYTES) throw new ValidationError("That file is too big. Split it into files under 2 MB.");
  // Matched against everyone in this account or office, including archived clients, so an archived person is not added again.
  const org = scope.organizationId ?? undefined;
  const existing = await deps.ws.listClients({ includeArchived: true, ...(org ? { organizationId: org } : {}) });
  const plan = planContactImport(input.csv, existing, input.tag ? [input.tag] : []);
  if (!input.confirm) return { plan, added: 0, failed: 0, done: false };

  let added = 0;
  let failed = 0;
  for (const p of plan.add) {
    try {
      await deps.ws.insertClient({ full_name: p.full_name, email: p.email, phone: p.phone, ssn_last4: null, address: p.address, tags: p.tags, created_by: scope.userId, owner_id: scope.userId, organization_id: scope.organizationId });
      added++;
    } catch {
      failed++;
    }
  }
  // The history records how many, never who.
  await deps.audit({ actor_id: scope.userId, action: "clients_imported", subject_type: "client", subject_id: null, detail: { added, skipped: plan.skipped.length, failed, rows: plan.total } });
  return { plan, added, failed, done: true };
}
