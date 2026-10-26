import { KINDS, type NewNotification } from "../notifications/types.ts";
import { dollars } from "./rules.ts";

/** The bell's wording for an invoice that was paid in full. */
export function invoicePaidNotification(invoice: { id: string; number: string; client_id: string; total_cents: number }, clientName: string): NewNotification {
  return {
    kind: KINDS.invoicePaid, title: `${clientName} paid invoice ${invoice.number}`, detail: dollars(invoice.total_cents),
    href: `/workspace/clients/${invoice.client_id}?tab=billing`, dedupeKey: `invoice:paid:${invoice.id}`,
  };
}
