import { FormattedInput } from "@/components/forms/formatted-input";
import { Modal } from "@/components/ui/modal";
import { invoiceStatusAction } from "@/app/(admin)/workspace/actions";
import { balance } from "@/lib/workspace/rules.ts";
import { RECEIPT_METHODS, type Invoice } from "@/lib/workspace/types.ts";

/** A Record payment button that opens a small form: the amount, the date, how it was paid and a reference. */
export function RecordPayment({ invoice: i, back, today, button = false }: { invoice: Invoice; back: string; today: string; button?: boolean }) {
  return (
    <Modal label="Record payment" title={`Record a payment on ${i.number}`} className={button ? "monarch-secondary" : "monarch-link"}>
      <form action={invoiceStatusAction} className="monarch-form">
        <input type="hidden" name="id" value={i.id} />
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="do" value="pay" />
        <label>Amount received *<FormattedInput kind="money" name="amount" defaultValue={(balance(i) / 100).toFixed(2)} placeholder="$0.00" /></label>
        <label>Date received<input name="paid_on" type="date" defaultValue={today} /></label>
        <label>How was it paid?
          <select name="method" defaultValue={i.payer === "bank_product" ? "bank_product" : "cash"}>
            {Object.entries(RECEIPT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Check number or reference<input name="reference" maxLength={80} /></label>
        <div className="is-wide"><button className="monarch-primary">Record payment</button></div>
      </form>
    </Modal>
  );
}
