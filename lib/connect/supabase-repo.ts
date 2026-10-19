import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import type { AppliedInvoice, Connection, ConnectRepo, InvoicePayment, PayableInvoice } from "./service.ts";

/** Connect rows of one office, on its tenant-scoped client. */
export class SupabaseConnectRepo implements ConnectRepo {
  private db: SupabaseClient;
  private tenantId: string;
  constructor(db: SupabaseClient, tenantId: string) {
    this.db = db;
    this.tenantId = tenantId;
  }
  async getConnection() {
    return unwrap(await this.db.from("payment_connections").select("*").maybeSingle()) as Connection | null;
  }
  async saveConnection(input: Parameters<ConnectRepo["saveConnection"]>[0]) {
    return unwrap(await this.db.from("payment_connections").upsert({ tenant_id: this.tenantId, ...input, status: "connected", disconnected_at: null, connected_at: new Date().toISOString() }, { onConflict: "tenant_id" }).select("*").single()) as Connection;
  }
  async updateConnection(patch: Parameters<ConnectRepo["updateConnection"]>[0]) {
    return unwrap(await this.db.from("payment_connections").update(patch).eq("tenant_id", this.tenantId).select("*").single()) as Connection;
  }
  async getInvoice(id: string) {
    return unwrap(await this.db.from("invoices").select("id, client_id, number, status, total_cents, paid_cents").eq("id", id).maybeSingle()) as PayableInvoice | null;
  }
  async openPaymentFor(invoiceId: string) {
    return unwrap(await this.db.from("invoice_payments").select("*").eq("invoice_id", invoiceId).eq("status", "open").maybeSingle()) as InvoicePayment | null;
  }
  async getPayment(id: string) {
    return unwrap(await this.db.from("invoice_payments").select("*").eq("id", id).maybeSingle()) as InvoicePayment | null;
  }
  async getPaymentBySession(sessionId: string) {
    return unwrap(await this.db.from("invoice_payments").select("*").eq("stripe_session_id", sessionId).maybeSingle()) as InvoicePayment | null;
  }
  async insertPayment(input: Parameters<ConnectRepo["insertPayment"]>[0]) {
    return unwrap(await this.db.from("invoice_payments").insert(input).select("*").single()) as InvoicePayment;
  }
  async attachSession(id: string, sessionId: string) {
    unwrap(await this.db.from("invoice_payments").update({ stripe_session_id: sessionId }).eq("id", id));
  }
  async closePayment(id: string, status: "expired" | "failed") {
    unwrap(await this.db.from("invoice_payments").update({ status, closed_at: new Date().toISOString() }).eq("id", id).eq("status", "open"));
  }
  async applyPayment(id: string, paymentIntent: string | null) {
    const rows = unwrap(await this.db.rpc("portal_apply_payment", { p_payment: id, p_payment_intent: paymentIntent })) as AppliedInvoice[] | null;
    return rows && rows.length ? rows[0] : null;
  }
  async addAudit(input: Parameters<ConnectRepo["addAudit"]>[0]) {
    unwrap(await this.db.from("workspace_audit_events").insert({ actor_id: input.actor_id, action: input.action, subject_type: input.subject_type, subject_id: input.subject_id, detail: input.detail ?? {} }));
  }
}
