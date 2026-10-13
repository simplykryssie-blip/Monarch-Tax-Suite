// Fees & Statements vocabulary. Free of server imports so the engine and tests load it directly.

export const APPLIES = ["every_return", "bank_product"] as const;
export type Applies = (typeof APPLIES)[number];

export type FeeSchedule = { id: string; organization_id: string | null; name: string; notes: string | null; updated_at: string };
export type FeeLine = {
  id: string; schedule_id: string; code: string; label: string; amount_cents: number; applies: Applies;
  bank_option_id: string | null; kind: "fee"; sort_order: number;
};
export type LineInput = Pick<FeeLine, "code" | "label" | "amount_cents" | "applies" | "bank_option_id" | "sort_order">;

export type TaxReturn = {
  id: string; organization_id: string; tax_year: number; return_ref: string; taxpayer_name: string; bank_option_id: string | null;
  filed_on: string | null; funded_on: string | null; source: "manual" | "import"; notes: string | null;
  archived_at: string | null; archive_reason: string | null; created_at: string; updated_at: string;
};
export type ReturnInput = Pick<TaxReturn, "organization_id" | "tax_year" | "return_ref" | "taxpayer_name" | "bank_option_id" | "filed_on" | "funded_on" | "notes"> & { source?: TaxReturn["source"] };

export type ReturnFee = { id: string; return_id: string; code: string; label: string; amount_cents: number; applies: Applies; schedule_id: string | null; sort_order: number };
export type Charge = Omit<ReturnFee, "id" | "return_id">;

export type BankImport = { id: string; bank_option_id: string; file_name: string; file_sha256: string; row_count: number; matched_count: number; unmatched_count: number; created_at: string };
export type Receipt = {
  id: string; kind: "bank" | "ero_payment"; organization_id: string | null; return_id: string | null; import_id: string | null; bank_option_id: string | null;
  owed_cents: number | null; collected_cents: number; received_on: string | null; reference: string | null; row_ref: string | null; row_name: string | null;
  note: string | null; created_at: string;
};
export type ReceiptInput = Omit<Receipt, "id" | "created_at">;

export type MappingKind = "returns" | "bank";
export type Mapping = Record<string, string>;

export type FeeEvent = {
  id: string; entity: "schedule" | "line" | "return" | "import" | "receipt" | "statement"; record_id: string | null; organization_id: string | null;
  action: string; actor_id: string | null; detail: Record<string, unknown>; reason: string | null; created_at: string;
};
export type EventInput = Omit<FeeEvent, "id" | "created_at">;

export type Office = { id: string; name: string; archived: boolean };
export type Bank = { id: string; name: string; active: boolean };

/** Everything the fee service reads and writes. The Supabase version is tenant-scoped by row-level security. */
export interface FeesRepo {
  listOffices(): Promise<Office[]>;
  listBanks(): Promise<Bank[]>;

  getDefaultSchedule(): Promise<FeeSchedule | null>;
  getOfficeSchedule(officeId: string): Promise<FeeSchedule | null>;
  listOfficeSchedules(): Promise<FeeSchedule[]>;
  insertSchedule(input: { organization_id: string | null; name: string; created_by: string | null }): Promise<FeeSchedule>;
  deleteSchedule(id: string): Promise<void>;
  listLines(scheduleIds: string[]): Promise<FeeLine[]>;
  insertLine(scheduleId: string, input: LineInput): Promise<FeeLine>;
  updateLine(id: string, patch: Partial<LineInput>): Promise<FeeLine>;
  deleteLine(id: string): Promise<void>;

  listReturns(filter: { officeId?: string; taxYear?: number; ids?: string[] }): Promise<TaxReturn[]>;
  getReturn(id: string): Promise<TaxReturn | null>;
  findReturnsByRef(ref: string, taxYear?: number): Promise<TaxReturn[]>;
  insertReturn(input: ReturnInput & { created_by: string | null }): Promise<TaxReturn>;
  updateReturn(id: string, patch: Partial<ReturnInput> & { archived_at?: string | null; archived_by?: string | null; archive_reason?: string | null }): Promise<TaxReturn>;
  listFees(returnIds: string[]): Promise<ReturnFee[]>;
  replaceFees(returnId: string, charges: Charge[]): Promise<void>;

  findImportByHash(sha256: string): Promise<BankImport | null>;
  insertImport(input: Omit<BankImport, "id" | "created_at"> & { imported_by: string | null }): Promise<BankImport>;
  listImports(): Promise<BankImport[]>;
  listReceipts(filter: { returnIds?: string[]; unmatched?: boolean; importId?: string }): Promise<Receipt[]>;
  insertReceipts(rows: (ReceiptInput & { created_by: string | null })[]): Promise<Receipt[]>;
  linkReceipt(id: string, link: { return_id: string; organization_id: string }): Promise<Receipt>;
  getReceipt(id: string): Promise<Receipt | null>;

  getMapping(kind: MappingKind): Promise<Mapping | null>;
  saveMapping(kind: MappingKind, mapping: Mapping, actorId: string | null): Promise<void>;

  addEvent(input: EventInput): Promise<void>;
  listEvents(filter: { entity?: FeeEvent["entity"]; recordId?: string; organizationId?: string; limit?: number }): Promise<FeeEvent[]>;
}
