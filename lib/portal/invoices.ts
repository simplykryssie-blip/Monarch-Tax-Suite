// Invoices in the portal. An invoice the office has sent (or that has been paid) shows to its client; drafts and voided
// invoices never do. The client sees the lines, total, what was paid and what is left, and the due date; internal notes
// stay with staff.

export type PortalInvoice = {
  id: string; number: string; tax_year: number; status: "sent" | "paid"; lines: { label: string; amount_cents: number }[];
  total_cents: number; paid_cents: number; issued_on: string; due_on: string | null; paid_on: string | null;
};
export const PORTAL_INVOICE_STATUSES = ["sent", "paid"] as const;

const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export const owed = (i: Pick<PortalInvoice, "total_cents" | "paid_cents">) => Math.max(0, i.total_cents - i.paid_cents);

/** "Overdue" is a fact about the date, not a stored status. */
export const isOverdue = (i: Pick<PortalInvoice, "status" | "due_on" | "total_cents" | "paid_cents">, todayIso: string) => i.status === "sent" && owed(i) > 0 && i.due_on !== null && i.due_on < todayIso;

export function invoiceNoticeEmail(input: { office: string; name: string; number: string; totalCents: number; link: string }) {
  return {
    subject: `New invoice ${input.number} from ${input.office}`,
    text: [
      `Hi ${input.name},`,
      "",
      `${input.office} sent you invoice ${input.number} for ${usd(input.totalCents)}.`,
      "",
      "You can see it in your client portal:",
      input.link,
    ].join("\n"),
  };
}

/** The email that tells a client they have a new message waiting in their portal. The message itself is read in the portal. */
export function portalMessageEmail(input: { office: string; name: string; link: string }) {
  return {
    subject: `New message from ${input.office}`,
    text: [`Hi ${input.name},`, "", `${input.office} sent you a message in your client portal.`, "", "Read it here:", input.link].join("\n"),
  };
}
