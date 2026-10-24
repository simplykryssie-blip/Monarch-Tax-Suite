import "server-only";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import { receiptsFor } from "./service.ts";
import type { ReceiptMethod, WorkspaceRepo } from "./types.ts";

/** One payment on an invoice, however it arrived: recorded by hand, applied from a bank statement, or paid online through Stripe. */
export type PaymentLine = { id: string; invoice_id: string; amount_cents: number; method: ReceiptMethod; reference: string | null; received_on: string; source: "manual" | "bank_import" | "stripe" };

export async function paymentsFor(repo: WorkspaceRepo, invoiceIds: string[]): Promise<PaymentLine[]> {
  if (invoiceIds.length === 0) return [];
  const [receipts, online] = await Promise.all([
    receiptsFor(repo, invoiceIds),
    tenantClient(currentTenantId()).from("invoice_payments").select("id, invoice_id, amount_cents, paid_at").eq("status", "paid").in("invoice_id", invoiceIds).then((r) => r.data ?? [], () => []),
  ]);
  return [
    ...receipts.map((r): PaymentLine => ({ id: r.id, invoice_id: r.invoice_id, amount_cents: r.amount_cents, method: r.method, reference: r.reference, received_on: r.received_on, source: r.source })),
    ...online.map((p): PaymentLine => ({ id: p.id, invoice_id: p.invoice_id, amount_cents: p.amount_cents, method: "card", reference: "Paid online (Stripe)", received_on: String(p.paid_at ?? "").slice(0, 10), source: "stripe" })),
  ].sort((a, b) => b.received_on.localeCompare(a.received_on));
}
