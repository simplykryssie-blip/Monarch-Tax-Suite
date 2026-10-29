import type { Installment } from "./plan.ts";
// My Workspace: the account holder's own clients, the returns they prepare (the My Work board), each client's
// documents, messages, tasks and notes, invoices, and bank-statement imports that match payments to invoices.

export type Client = {
  id: string; tenant_id: string; full_name: string; email: string | null; phone: string | null; ssn_last4: string | null; address: string | null;
  archived_at: string | null; created_by: string | null; created_at: string; updated_at: string;
  /** The preparer who owns the client (people see their own clients), and the office whose team entered them (null = the account's own). */
  owner_id: string | null; organization_id: string | null;
  /** Labels on the client (the column has been there since automations; older rows may not carry it). */
  tags?: string[] | null;
  /** Name in parts, date of birth, address in parts, and the other client this one is married to. Older rows may not carry them. */
  first_name?: string | null; last_name?: string | null; dob?: string | null;
  address_line1?: string | null; address_line2?: string | null; city?: string | null; state?: string | null; zip?: string | null;
  spouse_id?: string | null;
  /** Driver's license, and whether the address is the one used on last year's return (if not, the old address). */
  dl_number?: string | null; dl_state?: string | null; dl_issued_on?: string | null; dl_expires_on?: string | null;
  address_same_as_last_year?: boolean;
  /** Whether the client filed with their spouse last year (empty until answered). */
  filed_with_spouse_last_year?: boolean | null;
  prior_address_line1?: string | null; prior_address_line2?: string | null; prior_city?: string | null; prior_state?: string | null; prior_zip?: string | null;
};
export type ClientInput = Pick<Client, "full_name" | "email" | "phone" | "ssn_last4" | "address"> & Partial<Pick<Client, "first_name" | "last_name" | "dob" | "address_line1" | "address_line2" | "city" | "state" | "zip" | "dl_number" | "dl_state" | "dl_issued_on" | "dl_expires_on" | "address_same_as_last_year" | "prior_address_line1" | "prior_address_line2" | "prior_city" | "prior_state" | "prior_zip" | "filed_with_spouse_last_year">>;

export const RELATIONSHIPS = { child: "Child", stepchild: "Stepchild", foster_child: "Foster child", grandchild: "Grandchild", sibling: "Sibling", parent: "Parent", other_relative: "Other relative", other: "Other" } as const;
export type Relationship = keyof typeof RELATIONSHIPS;
export type Dependent = { id: string; tenant_id: string; client_id: string; first_name: string; last_name: string | null; dob: string | null; relationship: Relationship; ssn_last4: string | null; created_at: string };
export type DependentInput = Pick<Dependent, "client_id" | "first_name" | "last_name" | "dob" | "relationship" | "ssn_last4"> & { created_by: string | null };

export const ENTITY_TYPES = { sole_proprietor: "Sole proprietor", llc: "LLC", s_corp: "S corporation", c_corp: "C corporation", partnership: "Partnership", nonprofit: "Nonprofit", other: "Other" } as const;
export type EntityType = keyof typeof ENTITY_TYPES;
export type Business = { id: string; tenant_id: string; client_id: string; name: string; entity_type: EntityType; ein: string | null; phone: string | null; email?: string | null; address: string | null; created_at: string };
export type BusinessInput = Pick<Business, "client_id" | "name" | "entity_type" | "ein" | "phone" | "address"> & { email?: string | null; created_by: string | null };

/** A spouse entered by hand, for a spouse who is not a client. */
export type Spouse = { id: string; tenant_id: string; client_id: string; first_name: string; last_name: string | null; dob: string | null; phone: string | null; email: string | null; ssn_last4: string | null; dl_number?: string | null; dl_state?: string | null; dl_issued_on?: string | null; dl_expires_on?: string | null; created_at: string };
export type SpouseInput = Pick<Spouse, "client_id" | "first_name" | "last_name" | "dob" | "phone" | "email" | "ssn_last4" | "dl_number" | "dl_state" | "dl_issued_on" | "dl_expires_on"> & { created_by: string | null };

/** One line of the record of what staff did on a client's card. */
export type ClientEvent = { id: string; action: string; actor_id: string | null; detail: Record<string, unknown>; created_at: string };

export const RETURN_KINDS = { original: "Original", extension: "Extension", amendment: "Amendment" } as const;
export type ReturnKind = keyof typeof RETURN_KINDS;
export const PREP_STATUSES = { not_started: "Not started", in_prep: "In prep", ready_for_review: "Ready for review", handed_off: "Handed to ERO" } as const;
export type PrepStatus = keyof typeof PREP_STATUSES;
export const FORM_TYPES = { "1040": "1040", "1040-SR": "1040-SR", "1040-NR": "1040-NR", "1120": "1120", "1120-S": "1120-S", "1065": "1065", "990": "990", "941": "941", "940": "940", other: "Other" } as const;
export type FormType = keyof typeof FORM_TYPES;
export const FILING_STATUSES = { single: "Single", married_joint: "Married filing jointly", married_separate: "Married filing separately", head_of_household: "Head of household", qualifying_surviving_spouse: "Qualifying surviving spouse" } as const;
export type FilingStatus = keyof typeof FILING_STATUSES;
export const EFILE_STATUSES = { not_sent: "Not sent", transmitted: "Transmitted", accepted: "Accepted", rejected: "Rejected" } as const;
export type EfileStatus = keyof typeof EFILE_STATUSES;
export const RESULT_KINDS = { refund: "Refund", owed: "Amount owed" } as const;
export type ResultKind = keyof typeof RESULT_KINDS;
export const STATE_FILING_STATUSES = { not_started: "Not started", in_prep: "In prep", filed: "Filed", accepted: "Accepted", rejected: "Rejected" } as const;
export type StateFilingStatus = keyof typeof STATE_FILING_STATUSES;
export type StateFiling = { id: string; tenant_id: string; return_id: string; state: string; status: StateFilingStatus; filed_on: string | null; created_at: string };
/** The details an office tracks beyond stage and dates. Optional: a return made before they existed has none. */
export type ReturnDetails = { form_type?: FormType | null; filing_status?: FilingStatus | null; efile_status?: EfileStatus; efile_on?: string | null; efile_reject_reason?: string | null; result_kind?: ResultKind | null; result_cents?: number | null; fee_cents?: number | null };
export type ClientReturn = ReturnDetails & {
  id: string; tenant_id: string; client_id: string; tax_year: number; kind: ReturnKind; parent_id: string | null; stage_id: string;
  due_on: string | null; filed_on: string | null; notes: string | null; archived_at: string | null; created_at: string; updated_at: string;
  /** Who works the return, where it stands in preparation, and its office (null = the account's own). */
  assignee_id: string | null; prep_status: PrepStatus; handed_off_at: string | null; organization_id: string | null;
};
export type ReturnInput = Pick<ClientReturn, "client_id" | "tax_year" | "kind" | "parent_id" | "stage_id" | "due_on" | "notes">;

/** A piece of work that is not a tax return (planning, bookkeeping, payroll...). Its pipeline's name is the service. */
export type ClientWork = {
  id: string; tenant_id: string; client_id: string; pipeline_id: string; stage_id: string; title: string | null; due_on: string | null;
  assignee_id: string | null; notes: string | null; created_by: string | null; created_at: string; archived_at: string | null;
};
export type WorkInput = Pick<ClientWork, "client_id" | "pipeline_id" | "stage_id" | "title" | "due_on" | "notes">;

export type ClientDoc = { id: string; tenant_id: string; client_id: string; return_id: string | null; title: string; file_path: string; file_type: string; size_bytes: number | null; status: "pending" | "stored"; uploaded_by: string | null; /** The client folder it is kept in; none = the top of the client's own folder. */ folder_id?: string | null; created_at: string };
export type ClientMessage = {
  id: string; tenant_id: string; client_id: string; direction: "out" | "in"; channel: "email" | "sms" | "call" | "other" | "portal"; subject: string | null; body: string; occurred_at: string; created_by: string | null; created_at: string;
  /** "logged": written down by staff; "sent" / "failed": sent from the profile. */
  status: "logged" | "sent" | "failed"; sent_to: string | null; provider_id: string | null; error: string | null;
  /** Message segments a text used (what it cost in credits). */
  segments: number | null;
};
type SendFields = "status" | "sent_to" | "provider_id" | "error" | "segments";
export type NewClientMessage = Omit<ClientMessage, "id" | "tenant_id" | "created_at" | SendFields> & Partial<Pick<ClientMessage, SendFields>>;
export type ClientTask = { id: string; tenant_id: string; client_id: string; return_id: string | null; title: string; due_on: string | null; done_at: string | null; created_by: string | null; created_at: string };
export type ClientNote = { id: string; tenant_id: string; client_id: string; body: string; created_by: string | null; created_at: string };

/** `standard` marks a fee that comes from the tax software or bank product in Settings. Those are never edited on an invoice. */
export type InvoiceLine = { label: string; amount_cents: number; standard?: boolean };
export type InvoiceStatus = "draft" | "sent" | "paid" | "void";
export type Invoice = {
  id: string; tenant_id: string; client_id: string; return_id: string | null; number: string; tax_year: number; status: InvoiceStatus; lines: InvoiceLine[];
  total_cents: number; paid_cents: number; issued_on: string; due_on: string | null; paid_on: string | null; notes: string | null;
  created_by: string | null; created_at: string; updated_at: string;
  /** Sales tax figured on the invoice, and who pays: a bank product (taken from the refund) or the client out of pocket. */
  tax_percent?: number; tax_cents?: number; payer?: Payer | null; software_name?: string | null; bank_name?: string | null;
  /** Set when a voided invoice has been archived. */
  archived_at?: string | null;
};
export type Payer = "bank_product" | "self";
export const PAYERS: Record<Payer, string> = { bank_product: "Bank product", self: "Out of pocket" };
export type InvoiceInsert = Pick<Invoice, "client_id" | "return_id" | "number" | "tax_year" | "status" | "lines" | "total_cents" | "issued_on" | "due_on" | "notes"> & Partial<Pick<Invoice, "tax_percent" | "tax_cents" | "payer" | "software_name" | "bank_name">> & { created_by: string | null };

/** How a payment arrived. Payments made online through Stripe are recorded by Stripe and show as card payments. */
export const RECEIPT_METHODS = { cash: "Cash", check: "Check", card: "Card", bank_transfer: "Bank transfer", cash_app: "Cash App", zelle: "Zelle", venmo: "Venmo", bank_product: "Bank product payout", other: "Other" } as const;
export type ReceiptMethod = keyof typeof RECEIPT_METHODS;
export type InvoiceReceipt = { id: string; tenant_id: string; invoice_id: string; client_id: string; amount_cents: number; method: ReceiptMethod; reference: string | null; received_on: string; source: "manual" | "bank_import"; created_by: string | null; created_at: string };
export type ReceiptInsert = Pick<InvoiceReceipt, "invoice_id" | "client_id" | "amount_cents" | "method" | "reference" | "received_on" | "source"> & { created_by: string | null };

/** What goes at the bottom of every invoice, and the sales tax percent. */
export type BillingSettings = { refund_policy: string | null; terms: string | null; tax_percent: number };
/** A tax software or a bank product, with the standard fees it charges. */
export type FeeProduct = { id: string; tenant_id: string; kind: "software" | "bank"; name: string; lines: InvoiceLine[]; created_at: string; archived_at: string | null };
export type FeeProductInput = Pick<FeeProduct, "kind" | "name" | "lines">;

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
  insertClient(input: ClientInput & { created_by: string | null; owner_id?: string | null; organization_id?: string | null; tags?: string[] }): Promise<Client>;
  updateClient(id: string, patch: Partial<ClientInput> & { archived_at?: string | null; spouse_id?: string | null; tags?: string[]; owner_id?: string | null }): Promise<Client>;
  listDependents(clientId: string): Promise<Dependent[]>;
  insertDependent(input: DependentInput): Promise<Dependent>;
  deleteDependent(id: string): Promise<void>;
  listBusinesses(clientId: string): Promise<Business[]>;
  insertBusiness(input: BusinessInput): Promise<Business>;
  deleteBusiness(id: string): Promise<void>;
  getSpouse(clientId: string): Promise<Spouse | null>;
  upsertSpouse(input: SpouseInput): Promise<Spouse>;
  deleteSpouse(clientId: string): Promise<void>;
  /** The standard fee lines an invoice starts from. Null until the office has saved its own. */
  getInvoiceDefaults(): Promise<InvoiceLine[] | null>;
  saveInvoiceDefaults(lines: InvoiceLine[], actorId: string | null): Promise<void>;
  listInstallments(invoiceIds: string[]): Promise<(Installment & { invoice_id: string })[]>;
  replaceInstallments(invoiceId: string, plan: Installment[]): Promise<void>;
  listReceipts(invoiceIds?: string[]): Promise<InvoiceReceipt[]>;
  insertReceipt(input: ReceiptInsert): Promise<InvoiceReceipt>;
  getBillingSettings(): Promise<BillingSettings | null>;
  saveBillingSettings(s: BillingSettings, actorId: string | null): Promise<void>;
  listFeeProducts(): Promise<FeeProduct[]>;
  insertFeeProduct(input: FeeProductInput & { created_by: string | null }): Promise<FeeProduct>;
  updateFeeProduct(id: string, patch: Partial<Pick<FeeProduct, "name" | "lines" | "archived_at">>): Promise<FeeProduct>;
  /** Records and lists what staff did on a client's card (written to the append-only workspace audit log). */
  addClientEvent(e: { clientId: string; action: string; actorId: string | null; detail: Record<string, unknown> }): Promise<void>;
  listClientEvents(clientId: string, limit: number): Promise<ClientEvent[]>;
  /** Moves everything on `drop` to `keep` in one step and archives `drop`. Returns how much of each kind moved. */
  mergeClients(keep: string, drop: string, actorId: string | null): Promise<Record<string, number>>;

  listStateFilings(returnId: string): Promise<StateFiling[]>;
  saveStateFiling(returnId: string, state: string, status: StateFilingStatus, filedOn: string | null): Promise<StateFiling>;
  removeStateFiling(id: string): Promise<void>;
  listReturns(f?: { year?: number; clientId?: string; includeArchived?: boolean; assigneeId?: string; organizationId?: string }): Promise<ClientReturn[]>;
  getReturn(id: string): Promise<ClientReturn | null>;
  listWork(f?: { clientId?: string; pipelineId?: string }): Promise<ClientWork[]>;
  getWork(id: string): Promise<ClientWork | null>;
  insertWork(input: WorkInput & { created_by: string | null; assignee_id?: string | null }): Promise<ClientWork>;
  updateWork(id: string, patch: Partial<Pick<ClientWork, "stage_id" | "title" | "due_on" | "notes" | "assignee_id" | "archived_at">>): Promise<ClientWork>;
  insertReturn(input: ReturnInput & { assignee_id?: string | null; organization_id?: string | null }): Promise<ClientReturn>;
  updateReturn(id: string, patch: Partial<Pick<ClientReturn, "stage_id" | "due_on" | "filed_on" | "notes" | "archived_at" | "assignee_id" | "prep_status" | "handed_off_at">> & ReturnDetails): Promise<ClientReturn>;

  listDocs(clientId: string): Promise<ClientDoc[]>;
  getDoc(id: string): Promise<ClientDoc | null>;
  insertDoc(input: Omit<ClientDoc, "id" | "tenant_id" | "created_at">): Promise<ClientDoc>;
  updateDoc(id: string, patch: Partial<Pick<ClientDoc, "status" | "folder_id">>): Promise<ClientDoc>;
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
  updateInvoice(id: string, patch: Partial<Pick<Invoice, "status" | "lines" | "total_cents" | "paid_cents" | "paid_on" | "due_on" | "notes" | "tax_year" | "tax_cents" | "payer" | "archived_at">>): Promise<Invoice>;
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
