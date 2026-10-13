// Archive instead of delete, one pattern for the whole platform. "Remove" archives a record: it disappears from the
// default lists, keeps every link to it, and can be restored. Hard delete is a separate, owner-only step for records
// that are already archived, and never applies to an order that took money. Pure, so pages, actions and tests share
// the same rules; lib/archive-service.ts applies them and writes the history.

export const ARCHIVE_ENTITIES = ["customer", "order", "license", "product", "service_order", "document", "workflow", "form"] as const;
export type ArchiveEntity = (typeof ARCHIVE_ENTITIES)[number];

export const isArchiveEntity = (v: unknown): v is ArchiveEntity => typeof v === "string" && (ARCHIVE_ENTITIES as readonly string[]).includes(v);

export const ENTITY: Record<ArchiveEntity, { table: string; noun: string; list: string; detail: (id: string) => string; confirmWhat: string }> = {
  customer: { table: "calculator_customers", noun: "customer", list: "/customers", detail: (id) => `/customers/${id}`, confirmWhat: "the customer's email" },
  order: { table: "orders", noun: "order", list: "/orders", detail: (id) => `/orders/${id}`, confirmWhat: "the order number" },
  license: { table: "calculator_licenses", noun: "license", list: "/licenses", detail: (id) => `/licenses/${id}`, confirmWhat: "the license key's first part (for example MTS-ABC12)" },
  product: { table: "products", noun: "product", list: "/products", detail: (id) => `/products/${id}`, confirmWhat: "the product's web address name (slug)" },
  service_order: { table: "service_orders", noun: "service order", list: "/service-orders", detail: (id) => `/service-orders/${id}`, confirmWhat: "the order number it was bought on" },
  document: { table: "documents", noun: "document", list: "/documents", detail: (id) => `/documents/${id}`, confirmWhat: "the document's name" },
  workflow: { table: "automation_workflows", noun: "workflow", list: "/automation/workflows", detail: (id) => `/automation/workflows/${id}`, confirmWhat: "the workflow's name" },
  form: { table: "forms", noun: "form", list: "/forms", detail: (id) => `/forms/${id}/settings`, confirmWhat: "the form's name" },
};

/** The four tables whose own status already had "archived"; for them the status moves with the archive. */
export const STATUS_ARCHIVED: ReadonlySet<ArchiveEntity> = new Set(["product", "document", "workflow", "form"]);

export type ArchiveFields = { archived_at?: string | null; archived_by?: string | null; archive_reason?: string | null };
export type ArchiveRow = ArchiveFields & { id: string } & Record<string, unknown>;

// ------------------------------------------------------------------ lists

export type ArchiveView = "current" | "archived";
export const viewOf = (raw: string | string[] | undefined): ArchiveView => (raw === "archived" ? "archived" : "current");
export const isArchived = (row: ArchiveFields) => !!row.archived_at;
/** The rows a list shows: current ones by default, archived ones only on the Archived tab. */
export const inView = <T extends ArchiveFields>(rows: T[], view: ArchiveView): T[] => rows.filter((r) => isArchived(r) === (view === "archived"));
export const viewCounts = (rows: ArchiveFields[]) => {
  const archived = rows.filter(isArchived).length;
  return { current: rows.length - archived, archived };
};

// ------------------------------------------------------------------ rules

/** What the rules need to know about a record's links. */
export type ArchiveFacts = {
  licenses?: { status: string; archived_at?: string | null }[];
  serviceOrders?: { status: string }[];
  orders?: OrderMoney[];
  orderNumber?: number | null;
};
export type OrderMoney = { amount_cents: number; payment_status: string; paid_at?: string | null };

const LIVE_LICENSE = (l: { status: string }) => !["revoked", "expired"].includes(l.status);
const OPEN_SERVICE = (s: { status: string }) => !["delivered", "canceled"].includes(s.status);

/** True when an order took real money: it is a financial record and is never hard-deleted. */
export function moneyTaken(o: OrderMoney): boolean {
  if (o.amount_cents <= 0) return false;
  return !!o.paid_at || ["paid", "refunded", "partially_refunded", "disputed"].includes(o.payment_status);
}

/**
 * Why a record can't be archived yet, or null. Archiving changes nothing else about a record, so anything still live
 * has to be dealt with first: a license is revoked; a customer's licenses and service orders are closed.
 */
export function archiveProblem(entity: ArchiveEntity, row: ArchiveRow, facts: ArchiveFacts = {}): string | null {
  if (isArchived(row)) return "This is already archived.";
  const liveLicenses = (facts.licenses ?? []).filter(LIVE_LICENSE).length;
  const openServices = (facts.serviceOrders ?? []).filter(OPEN_SERVICE).length;
  switch (entity) {
    case "license":
      return LIVE_LICENSE(row as unknown as { status: string }) ? "Revoke this license first. Archiving only hides it; it doesn't stop a license from working." : null;
    case "customer":
      if (liveLicenses) return `This customer still has ${liveLicenses === 1 ? "a license" : `${liveLicenses} licenses`} that isn't revoked or expired. Revoke ${liveLicenses === 1 ? "it" : "them"} first.`;
      if (openServices) return `This customer still has ${openServices === 1 ? "an open service order" : `${openServices} open service orders`}. Deliver or cancel ${openServices === 1 ? "it" : "them"} first.`;
      return null;
    case "order":
      if (liveLicenses) return "This order's license isn't revoked or expired. Revoke it first.";
      if (openServices) return "This order's service order is still open. Deliver or cancel it first.";
      return null;
    case "service_order":
      return OPEN_SERVICE(row as unknown as { status: string }) ? "Deliver or cancel this service order first." : null;
    default:
      return null;
  }
}

/** What the owner types to confirm a hard delete. */
export function confirmText(entity: ArchiveEntity, row: ArchiveRow, facts: ArchiveFacts = {}): string {
  const s = (k: string) => (typeof row[k] === "string" ? (row[k] as string) : row[k] == null ? "" : String(row[k]));
  switch (entity) {
    case "customer": return s("email");
    case "order": return s("order_number");
    case "license": return s("key_prefix");
    case "product": return s("slug");
    case "service_order": return facts.orderNumber != null ? String(facts.orderNumber) : row.id.slice(0, 8);
    default: return s("name");
  }
}

/** A short label for the history, so it still says what a record was after it is deleted. */
export function recordLabel(entity: ArchiveEntity, row: ArchiveRow, facts: ArchiveFacts = {}): string {
  const s = (k: string) => (row[k] == null ? "" : String(row[k]));
  const label = (() => {
    switch (entity) {
      case "customer": return [s("full_name"), s("email")].filter(Boolean).join(" · ");
      case "order": return `Order #${s("order_number")}${typeof row.amount_cents === "number" ? ` ($${((row.amount_cents as number) / 100).toFixed(2)})` : ""}`;
      case "license": return `License ${s("key_prefix")}`;
      case "service_order": return `Service order${facts.orderNumber != null ? ` for order #${facts.orderNumber}` : ""}${s("deliverable") ? ` · ${s("deliverable")}` : ""}`;
      default: return s("name");
    }
  })();
  return (label || `${ENTITY[entity].noun} ${row.id.slice(0, 8)}`).slice(0, 200);
}

/**
 * Why a record can't be hard-deleted, or null. Only already-archived records, only by the account owner, only with
 * the record's email or number typed exactly, and never an order that took money (or a customer with one).
 */
export function hardDeleteProblem(entity: ArchiveEntity, row: ArchiveRow, facts: ArchiveFacts, input: { isOwner: boolean; confirm: string }): string | null {
  if (!input.isOwner) return "Only the account owner can permanently delete records.";
  if (!isArchived(row)) return `Archive this ${ENTITY[entity].noun} first. Only archived records can be permanently deleted.`;
  if (entity === "order" && moneyTaken(row as unknown as OrderMoney)) return "This order took real money, so it is a financial record and is kept. It stays archived.";
  if (entity === "customer" && (facts.orders ?? []).some(moneyTaken)) return "This customer has an order that took real money. Financial records are kept, so the customer stays archived.";
  const expected = confirmText(entity, row, facts);
  const typed = input.confirm.trim();
  const match = entity === "customer" ? typed.toLowerCase() === expected.toLowerCase() : typed === expected;
  if (!expected || !match) return `Type ${ENTITY[entity].confirmWhat} exactly to confirm: ${expected}`;
  return null;
}

/** The status a status-archived record returns to when restored (it never comes back live on its own). */
export function restoredStatus(entity: ArchiveEntity, row: ArchiveRow): string | null {
  switch (entity) {
    case "product": return row.stripe_price_id ? "unpublished" : "draft";
    case "document": return "active";
    case "workflow": return "paused";
    case "form": return row.current_version_id ? "closed" : "draft";
    default: return null;
  }
}

export const cleanReason = (raw: unknown): string | null => {
  const v = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) : "";
  return v || null;
};

export type ArchiveAction = "archived" | "restored" | "auto_restored" | "deleted";
export type ArchiveLogEntry = { entity: ArchiveEntity; record_id: string; action: ArchiveAction; actor_id: string | null; label: string; reason: string | null };
export type ArchiveLogRow = ArchiveLogEntry & { id: string; tenant_id: string; created_at: string };
export const ACTION_LABELS: Record<ArchiveAction, string> = { archived: "Archived", restored: "Restored", auto_restored: "Restored automatically", deleted: "Permanently deleted" };
