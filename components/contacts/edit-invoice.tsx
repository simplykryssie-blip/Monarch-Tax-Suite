import { FormattedInput } from "@/components/forms/formatted-input";
import { Modal } from "@/components/ui/modal";
import { editInvoiceAction } from "@/app/(admin)/workspace/actions";
import type { Invoice } from "@/lib/workspace/types.ts";

const ROWS = 10;

/** An Edit button for an invoice that isn't paid or void. With a payment on it only the due date, notes and who pays can change. */
export function EditInvoice({ invoice: i, back }: { invoice: Invoice; back: string }) {
  if (i.status === "paid" || i.status === "void") return null;
  const open = i.paid_cents === 0;
  return (
    <Modal label="Edit" title={`Edit ${i.number}`} className="monarch-link" wide>
      <form action={editInvoiceAction} className="monarch-form">
        <input type="hidden" name="id" value={i.id} />
        <input type="hidden" name="back" value={back} />
        {open && <label>Tax year *<input name="tax_year" required inputMode="numeric" maxLength={4} defaultValue={i.tax_year} /></label>}
        <label>Due date<input name="due_on" type="date" defaultValue={i.due_on ?? ""} /></label>
        <fieldset className="is-wide ni-choice">
          <legend>Paid by</legend>
          <label className="monarch-check"><input type="radio" name="payer" value="bank_product" defaultChecked={i.payer === "bank_product"} /> Bank product</label>
          <label className="monarch-check"><input type="radio" name="payer" value="self" defaultChecked={i.payer !== "bank_product"} /> Out of pocket</label>
        </fieldset>
        {open ? (
          <fieldset className="is-wide ni-charges">
            <legend>Charges</legend>
            {Array.from({ length: ROWS }, (_, n) => i.lines[n] ?? { label: "", amount_cents: 0 }).map((l, n) => (
              <div key={n} className="ni-charge">
                <label>What it&apos;s for<input name={`line_label_${n}`} defaultValue={l.label} maxLength={120} /></label>
                <label>Amount<FormattedInput kind="money" name={`line_amount_${n}`} defaultValue={l.label ? (l.amount_cents / 100).toFixed(2) : ""} placeholder="$0.00" /></label>
              </div>
            ))}
            {(i.tax_cents ?? 0) > 0 && <small className="monarch-muted">Sales tax ({i.tax_percent}%) is figured again on the new total.</small>}
          </fieldset>
        ) : <p className="is-wide monarch-muted">A payment has been made on this invoice, so its charges can no longer change.</p>}
        <label className="is-wide">Notes<input name="notes" maxLength={1000} defaultValue={i.notes ?? ""} /></label>
        <div className="is-wide"><button className="monarch-primary">Save changes</button></div>
      </form>
    </Modal>
  );
}
