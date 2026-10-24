import Link from "next/link";
import { createInvoiceAction } from "@/app/(admin)/workspace/actions";
import { Modal } from "@/components/ui/modal";
import { dollars, invoiceTotal } from "@/lib/workspace/rules.ts";
import type { InvoiceLine } from "@/lib/workspace/types.ts";

/**
 * A New invoice button that opens the invoice form. The standard fees are shown but cannot be changed here (they are set in
 * Settings); the form only chooses whether to include them and adds any other charges.
 */
export function NewInvoice({ standard, back, year, clientId, clients, returns, disabled }: {
  standard: InvoiceLine[]; back: string; year: number;
  /** On a client's page the client is fixed; on Billing a client is chosen. */
  clientId?: string; clients?: { id: string; name: string }[]; returns?: { id: string; label: string }[]; disabled?: boolean;
}) {
  return (
    <Modal label="New invoice" title="New invoice" className="monarch-primary">
      <form action={createInvoiceAction} className="monarch-form">
        <input type="hidden" name="back" value={back} />
        {clientId ? <input type="hidden" name="client_id" value={clientId} /> : (
          <label className="is-wide">Client *<select name="client_id" required defaultValue=""><option value="" disabled>{clients?.length ? "Choose a client…" : "Add a client first"}</option>{(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        )}
        <label>Tax year *<input name="tax_year" required inputMode="numeric" maxLength={4} defaultValue={year} /></label>
        <label>Due date<input name="due_on" type="date" /></label>
        {returns && returns.length > 0 && <label>Which return is this for?<select name="return_id" defaultValue=""><option value="">No specific return</option>{returns.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>}
        <label>Status<select name="status" defaultValue="sent"><option value="sent">Sent</option><option value="draft">Draft</option></select></label>

        <fieldset className="is-wide ni-standard">
          <legend>Standard fees · {dollars(invoiceTotal(standard))}</legend>
          <ul>{standard.map((l, i) => <li key={i}><span>{l.label}</span><b>{dollars(l.amount_cents)}</b></li>)}</ul>
          <div className="ni-choice">
            <label className="monarch-check"><input type="radio" name="include_standard" value="yes" defaultChecked /> Include</label>
            <label className="monarch-check"><input type="radio" name="include_standard" value="no" /> Don&apos;t include</label>
            <Link className="monarch-link" href="/settings/invoice-fees">Change in Settings</Link>
          </div>
        </fieldset>

        <fieldset className="is-wide"><legend>Other charges</legend>
          {[0, 1, 2].map((n) => (
            <span key={n} className="ni-line">
              <input name={`line_label_${n}`} placeholder="Description" aria-label={`Charge ${n + 1} description`} maxLength={120} />
              <input name={`line_amount_${n}`} placeholder="Amount" aria-label={`Charge ${n + 1} amount`} size={10} />
            </span>
          ))}
        </fieldset>
        <label className="is-wide">Notes<input name="notes" maxLength={1000} /></label>
        <div className="is-wide ac-actions"><button className="monarch-primary" disabled={disabled}>Create invoice</button></div>
      </form>
    </Modal>
  );
}
