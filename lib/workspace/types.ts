// My Workspace: the account holder's own clients, the returns they prepare (the My Work board), each client's
// documents, messages, tasks and notes, invoices, and bank-statement imports that match payments to invoices.

export type Client = {
  id: string; tenant_id: string; full_name: string; email: string | null; phone: string | null; ssn_last4: string | null; address: string | null;
  archived_at: string | null; created_by: string | null; created_at: string; updated_at: string;
  /** The preparer who owns the client (people see their own clients), and the office whose team entered them (null = the account's own). */
  owner_id: string | null; organization_id: string | null;
};
export type ClientInput = Pick<Client, "full_name" | "email" | "phone" | "ssn_last4" | "address">;

export const RETURN_KINDS = { original: "Original", extension: "Extension", amendment: "Amendment" } as const;
export type ReturnKind = keyof typeof RETURN_KINDS;
export const PREP_STATUSES = { not_started: "Not started", in_prep: "In prep", ready_for_review: "Ready for review", handed_off: "Handed to ERO" } as const;
export type PrepStatus = keyof typeof PREP_STATUSES;
export type ClientReturn = {
  id: string; tenant_id: string; client_id: string; tax_year: number; kind: ReturnKind; parent_id: string | null; stage_id: string;
  due_on: string | null; filed_on: string | null; notes: string | null; archived_at: string | null; created_at: string; updated_at: string;
  /** Who works the return, where it stands in preparation, and its office (null = the account's own). */
  assignee_id: string | null; prep_status: PrepStatus; handed_off_at: string | null; organization_id: string | null;
};
export type ReturnInput = Pick<ClientReturn, "client_id" | "tax_year" | "kind" | "parent_id" | "stage_id" | "due_on" | "notes">;

export type ClientDoc = { id: string; tenant_id: string; client_id: string; return_id: string | null; title: string; file_path: string; file_type: string; size_bytes: number | null; status: "pending" | "stored"; uploaded_by: string | null; created_at: string };
export type ClientMessage = {
  id: string; tenant_id: string; client_id: string; direction: "out" | "in"; channel: "email" | "sms" | "call" | "other"; subject: string | null; body: string; occurred_at: string; created_by: string | null; created_at: string;
  /** "logged": written down by staff; "sent" / "failed": sent from the profile. */
  status: "logged" | "sent" | "failed"; sent_to: string | null; provider_id: string | null; error: string | null;
  /** Message segments a text used (what it cost in credits). */
  segments: number | null;
};
type SendFields = "status" | "sent_to" | "provider_id" | "error" | "segments";
export type NewClientMessage = Omit<ClientMessage, "id" | "tenant_id" | "created_at" | SendFields> & Partial<Pick<ClientMessage, SendFields>>;
export type ClientTask = { id: string; tenant_id: string; client_id: string; return_id: string | null; title: string; due_on: string | null; done_at: string | null; created_by: string | null; created_at: string };
export type ClientNote = { id: string; tenant_id: string; client_id: string; body: string; created_by: string | null; created_at: string };

export type InvoiceLine = { label: string; amount_cents: number };
export type InvoiceStatus = "draft" | "sent" | "paid" | "void";
export type Invoice = {
  id: string; tenant_id: string; client_id: string; return_id: string | null; number: string; tax_year: number; status: InvoiceStatus; lines: InvoiceLine[];
  total_cents: number; paid_cents: number; issued_on: string; due_on: string | null; paid_on: string | null; notes: string | null;
  created_by: string | null; created_at: string; updated_at: string;
};
export type InvoiceInsert = Pick<Invoice, "client_id" | "return_id" | "number" | "tax_year" | "status" | "lines" | "total_cents" | "issued_on" | "due_on" | "notes"> & { created_by: string | null };

export type MatchKind = "exact" | "possible" | "manual" | "none";
export type PaymentImport = { id: string; tenant_id: string; file_name: string; file_sha256: string; row_count: number; status: "review" | "applied" | "discarded"; created_by: string | null; created_at: string; applied_at: string | null };
export type PaymentRow = {
  id: string; tenant_id: string; import_id: string; row_no: number; posted_on: string | null; description: string; amount_cents: number;
  tax_year: number | null; ssn_last4: string | null; name_guess: string | null; invoice_id: string | null; match: MatchKind; status: "pending" | "ignored" | "applied"; created_at: string;
};
export type PaymentRowInsert = Pick<PaymentRow, "import_id" | "row_no" | "posted_on" | "description" | "amount_cents" | "tax_year" | "ssn_last4" | "name_guess" | "invoice_id" | "match">;

export interface WorkspaceRepo {
  listClients(f?: { q?: string; includeArchived?: boolean; ownerId?: string; organizationId?: string }): Promise<Client[]>;
  getClient(id: string): Promise<Client | null>;
  insertClient(input: ClientInput & { created_by: string | null; owner_id?: string | null; organization_id?: string | null }): Promise<Client>;
  updateClient(id: string, patch: Partial<ClientInput> & { archived_at?: string | null }): Promise<Client>;

  listReturns(f?: { year?: number; clientId?: string; includeArchived?: boolean; assigneeId?: string; organizationId?: string }): Promise<ClientReturn[]>;
  getReturn(id: string): Promise<ClientReturn | null>;
  insertReturn(input: ReturnInput & { assignee_id?: string | null; organization_id?: string | null }): Promise<ClientReturn>;
  updateReturn(id: string, patch: Partial<Pick<ClientReturn, "stage_id" | "due_on" | "filed_on" | "notes" | "archived_at" | "assignee_id" | "prep_status" | "handed_off_at">>): Promise<ClientReturn>;

  listDocs(clientId: string): Promise<ClientDoc[]>;
  getDoc(id: string): Promise<ClientDoc | null>;
  insertDoc(input: Omit<ClientDoc, "id" | "tenant_id" | "created_at">): Promise<ClientDoc>;
  updateDoc(id: string, patch: Partial<Pick<ClientDoc, "status">>): Promise<ClientDoc>;
  deleteDoc(id: string): Promise<void>;
  /** Uploads started before `before` that were never finished. */
  listStalePendingDocs(before: string): Promise<ClientDoc[]>;

  listMessages(clientId: string): Promise<ClientMessage[]>;
  insertMessage(input: NewClientMessage): Promise<ClientMessage>;
  listTasks(f?: { clientId?: string; openOnly?: boolean }): Promise<ClientTask[]>;
  insertTask(input: Pick<ClientTask, "client_id" | "return_id" | "title" | "due_on" | "created_by">): Promise<ClientTask>;
  updateTask(id: string, patch: Partial<Pick<ClientTask, "done_at">>): Promise<ClientTask>;
  listNotes(clientId: string): Promise<ClientNote[]>;
  insertNote(input: Pick<ClientNote, "client_id" | "body" | "created_by">): Promise<ClientNote>;

  listInvoices(f?: { clientId?: string; year?: number }): Promise<Invoice[]>;
  getInvoice(id: string): Promise<Invoice | null>;
  insertInvoice(input: InvoiceInsert): Promise<Invoice>;
  updateInvoice(id: string, patch: Partial<Pick<Invoice, "status" | "lines" | "total_cents" | "paid_cents" | "paid_on" | "due_on" | "notes">>): Promise<Invoice>;
  nextInvoiceNumber(): Promise<string>;

  insertImport(input: Pick<PaymentImport, "file_name" | "file_sha256" | "row_count" | "created_by">): Promise<PaymentImport>;
  getImport(id: string): Promise<PaymentImport | null>;
  findImportByHash(sha: string): Promise<PaymentImport | null>;
  listImports(limit: number): Promise<PaymentImport[]>;
  updateImport(id: string, patch: Partial<Pick<PaymentImport, "status" | "applied_at">>): Promise<PaymentImport>;
  insertImportRows(rows: PaymentRowInsert[]): Promise<PaymentRow[]>;
  listImportRows(importId: string): Promise<PaymentRow[]>;
  updateImportRow(id: string, patch: Partial<Pick<PaymentRow, "invoice_id" | "amount_cents" | "match" | "status">>): Promise<PaymentRow>;
}
