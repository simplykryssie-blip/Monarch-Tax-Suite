import { ValidationError } from "../commerce/validation.ts";
import { sourceName, type LeadsDeps } from "../leads/types.ts";
import { addClient } from "../workspace/service.ts";
import type { Client, WorkspaceRepo } from "../workspace/types.ts";

/**
 * Turns a lead into a client: the client is made with the lead's name, email, phone, tags and teammate, the lead's other
 * details are written into a note, and the lead is marked Converted. The lead and the client share an email address, so
 * Contacts shows them as one person. A person who is already a client is not made twice. The lead's documents move to the client
 * (`moveDocs`), so afterwards they are under the client only.
 */
export async function convertLeadToClient(repo: WorkspaceRepo, leads: LeadsDeps, leadId: string, actor: { id: string; email?: string | null }, moveDocs?: (leadId: string, clientId: string) => Promise<unknown>): Promise<{ client: Client; alreadyClient: boolean }> {
  const lead = await leads.repo.getLead(leadId);
  if (!lead) throw new ValidationError("That lead wasn't found.");
  const email = lead.email.trim().toLowerCase();
  const existing = (await repo.listClients({ q: email, includeArchived: true })).find((c) => (c.email ?? "").trim().toLowerCase() === email);
  if (existing) {
    if (existing.archived_at) throw new ValidationError(`${existing.full_name} is already a client, but archived. Restore them from their client page instead.`);
    if (lead.status !== "converted") await leads.repo.updateLead(lead.id, { status: "converted", converted_at: new Date().toISOString() });
    await moveDocs?.(lead.id, existing.id);
    return { client: existing, alreadyClient: true };
  }
  const client = await addClient(repo, { full_name: lead.full_name, email: lead.email, phone: lead.phone ?? undefined }, actor.id, null, actor);
  const patch: { tags?: string[]; owner_id?: string | null } = {};
  if (lead.tags.length) patch.tags = lead.tags;
  if (lead.assigned_to) patch.owner_id = lead.assigned_to;
  const saved = Object.keys(patch).length ? await repo.updateClient(client.id, patch) : client;
  const detail = ["Converted from a lead.", lead.firm_name ? `Firm: ${lead.firm_name}` : "", lead.source ? `Source: ${sourceName(lead.source)}` : "", lead.notes ? `Lead notes:\n${lead.notes}` : ""].filter(Boolean).join("\n");
  await repo.insertNote({ client_id: client.id, body: detail.slice(0, 4000), created_by: actor.id });
  await leads.repo.updateLead(lead.id, { status: "converted", converted_at: new Date().toISOString() });
  await leads.repo.addEvent({ lead_id: lead.id, action: "converted_to_client", detail: { client_id: client.id }, actor_id: actor.id });
  // The lead's documents move to the client and live there only.
  await moveDocs?.(lead.id, client.id);
  return { client: saved, alreadyClient: false };
}
