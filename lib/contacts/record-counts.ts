import type { Contact } from "./combine.ts";
import type { LeadsRepo } from "../leads/types.ts";
import type { WorkspaceRepo } from "../workspace/types.ts";

/** What is kept on a contact's client record, so two possible duplicates can be compared by how much each holds. Empty for a contact that is not a client. */
export type RecordCounts = { label: string; n: number }[];

export async function recordCounts(repo: WorkspaceRepo, c: Contact, leads?: LeadsRepo): Promise<RecordCounts> {
  const id = c.refs.clientId;
  if (!id) {
    // A lead holds notes (one text) and a history of what was done; it has no returns, invoices or documents.
    if (!c.refs.leadId || !leads) return [];
    const lead = await leads.getLead(c.refs.leadId).catch(() => null);
    const events = await leads.listEvents(c.refs.leadId).catch(() => []);
    return [{ label: "Notes", n: lead?.notes?.trim() ? 1 : 0 }, { label: "History entries", n: events.length }];
  }
  const count = async <T>(f: () => Promise<T[]>) => (await f().catch(() => [] as T[])).length;
  const [notes, returns, invoices, docs, tasks, messages] = await Promise.all([
    count(() => repo.listNotes(id)),
    count(() => repo.listReturns({ clientId: id, includeArchived: true })),
    count(() => repo.listInvoices({ clientId: id })),
    count(() => repo.listDocs(id)),
    count(() => repo.listTasks({ clientId: id })),
    count(() => repo.listMessages(id)),
  ]);
  return [
    { label: "Notes", n: notes }, { label: "Returns", n: returns }, { label: "Invoices", n: invoices },
    { label: "Documents", n: docs }, { label: "Tasks", n: tasks }, { label: "Messages", n: messages },
  ];
}
