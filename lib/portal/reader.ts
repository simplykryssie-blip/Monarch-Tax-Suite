import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import type { ClientMessage, ClientReturn } from "../workspace/types.ts";
import { PORTAL_INVOICE_STATUSES, type PortalInvoice } from "./invoices.ts";
import { portalMessageVisible } from "./visibility.ts";

// What the portal may read, for ONE client of ONE office. The database client is already limited to the office (row-level
// security); every query here also names the client, so a page built from this reader has no way to ask for another
// client's rows. It only selects the columns a client may see: no notes, tasks, internal flags or staff identities.

export type PortalClient = { id: string; full_name: string; email: string | null; phone: string | null; ssn_last4: string | null; address: string | null };
export type PortalReturn = Pick<ClientReturn, "id" | "tax_year" | "kind" | "stage_id" | "due_on" | "filed_on">;
export type PortalMessage = Pick<ClientMessage, "id" | "direction" | "channel" | "subject" | "body" | "occurred_at">;

export type PortalSignature = { deliveryId: string; name: string; status: "sent" | "viewed" | "signed" | "declined" | "expired" | "voided"; expiresAt: string; signedAt: string | null; createdAt: string };

export class PortalReader {
  private db: SupabaseClient;
  readonly tenantId: string;
  readonly clientId: string;
  constructor(db: SupabaseClient, tenantId: string, clientId: string) {
    this.db = db;
    this.tenantId = tenantId;
    this.clientId = clientId;
  }

  /** Last four digits only: the full number is never read for the portal. */
  async client() {
    return unwrap(await this.db.from("clients").select("id, full_name, email, phone, ssn_last4, address").eq("id", this.clientId).is("archived_at", null).maybeSingle()) as PortalClient | null;
  }
  async returns() {
    return unwrap(await this.db.from("client_returns").select("id, tax_year, kind, stage_id, due_on, filed_on").eq("client_id", this.clientId).is("archived_at", null).order("tax_year", { ascending: false }).limit(50)) as PortalReturn[];
  }
  async messages() {
    const rows = unwrap(await this.db.from("client_messages").select("id, direction, channel, subject, body, occurred_at, status").eq("client_id", this.clientId).order("occurred_at", { ascending: false }).limit(100)) as (PortalMessage & { status: ClientMessage["status"] })[];
    return rows.filter(portalMessageVisible).map((m) => ({ id: m.id, direction: m.direction, channel: m.channel, subject: m.subject, body: m.body, occurred_at: m.occurred_at }));
  }

  /** Signature requests made for this client (open and finished), newest first. */
  async signatures(): Promise<PortalSignature[]> {
    const deliveries = unwrap(await this.db.from("document_deliveries").select("id, document_id, created_at").eq("client_id", this.clientId).eq("kind", "signature").is("revoked_at", null).order("created_at", { ascending: false }).limit(50)) as { id: string; document_id: string; created_at: string }[];
    if (!deliveries.length) return [];
    const ids = deliveries.map((d) => d.id);
    const sigs = unwrap(await this.db.from("signature_requests").select("delivery_id, status, expires_at, signed_at").in("delivery_id", ids)) as { delivery_id: string; status: PortalSignature["status"]; expires_at: string; signed_at: string | null }[];
    const docs = unwrap(await this.db.from("documents").select("id, name").in("id", [...new Set(deliveries.map((d) => d.document_id))])) as { id: string; name: string }[];
    return deliveries.flatMap((d) => {
      const sig = sigs.find((s) => s.delivery_id === d.id);
      if (!sig) return [];
      return [{ deliveryId: d.id, name: docs.find((x) => x.id === d.document_id)?.name ?? "Document", status: sig.status, expiresAt: sig.expires_at, signedAt: sig.signed_at, createdAt: d.created_at }];
    });
  }

  /** Invoices the office sent, and paid ones. Never drafts, voided invoices or internal notes. */
  async invoices() {
    return unwrap(await this.db.from("invoices").select("id, number, tax_year, status, lines, total_cents, paid_cents, issued_on, due_on, paid_on").eq("client_id", this.clientId).in("status", [...PORTAL_INVOICE_STATUSES]).order("issued_on", { ascending: false }).limit(100)) as PortalInvoice[];
  }
}
