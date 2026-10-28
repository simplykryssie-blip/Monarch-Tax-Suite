import type { Contact } from "./combine.ts";
import type { WorkspaceRepo } from "../workspace/types.ts";

/** What is kept on a contact's client record, so two possible duplicates can be compared by how much each holds. Empty for a contact that is not a client. */
export type RecordCounts = { label: string; n: number }[];

export async function recordCounts(repo: WorkspaceRepo, c: Contact): Promise<RecordCounts> {
  const id = c.refs.clientId;
  if (!id) return [];
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
