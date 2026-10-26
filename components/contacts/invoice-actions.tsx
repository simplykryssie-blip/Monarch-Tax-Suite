import { EditInvoice } from "@/components/contacts/edit-invoice";
import { PaymentPlan } from "@/components/contacts/payment-plan";
import { RecordPayment } from "@/components/contacts/record-payment";
import { archiveInvoiceAction, invoiceStatusAction } from "@/app/(admin)/workspace/actions";
import type { Installment } from "@/lib/workspace/plan.ts";
import type { Invoice } from "@/lib/workspace/types.ts";

/** What can be done to an invoice: the one thing you usually want is a button, the rest are under "More". */
export function InvoiceActions({ invoice: i, plan, back, today }: { invoice: Invoice; plan: Installment[]; back: string; today: string }) {
  const open = i.status !== "paid" && i.status !== "void";
  const hidden = (<><input type="hidden" name="id" value={i.id} /><input type="hidden" name="back" value={back} /></>);
  const canVoid = i.status !== "void" && i.paid_cents === 0;
  const hasMore = open || i.status === "void" || canVoid;
  return (
    <div className="inv-actions">
      {i.status === "draft" && <form action={invoiceStatusAction}>{hidden}<button name="do" value="send" className="monarch-secondary">Send to client</button></form>}
      {i.status === "sent" && <RecordPayment invoice={i} back={back} today={today} button />}
      {hasMore && (
        <details className="row-menu">
          <summary>More</summary>
          <div className="row-menu-list">
            {i.status === "draft" && <RecordPayment invoice={i} back={back} today={today} />}
            <EditInvoice invoice={i} back={back} />
            <PaymentPlan invoice={i} plan={plan} back={back} />
            {i.status === "void" && <form action={archiveInvoiceAction}>{hidden}<input type="hidden" name="archive" value={i.archived_at ? "no" : "yes"} /><button className="monarch-link">{i.archived_at ? "Restore" : "Archive"}</button></form>}
            {canVoid && <form action={invoiceStatusAction}>{hidden}<button name="do" value="void" className="monarch-link is-danger">Void</button></form>}
          </div>
        </details>
      )}
    </div>
  );
}
