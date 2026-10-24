"use client";

import Link from "next/link";
import { useState } from "react";
import { createInvoiceAction } from "@/app/(admin)/workspace/actions";
import { FormattedInput } from "@/components/forms/formatted-input";
import { parseMoney } from "@/lib/fees/engine.ts";

export type InvoiceFormProps = {
  /** The standard fees, from Settings, in cents. */
  standard: { label: string; amount_cents: number }[];
  back: string;
  year: number;
  office: string;
  /** On a client's page the client is fixed; on Billing one is chosen. */
  clientId?: string;
  clientName?: string;
  clients?: { id: string; name: string }[];
  returns?: { id: string; label: string }[];
  disabled?: boolean;
};

type Charge = { label: string; amount: string };
const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const MAX_CHARGES = 8;

/** The invoice form on the left and what the invoice will look like on the right, updating as you type. */
export function NewInvoiceForm({ standard, back, year, office, clientId, clientName, clients, returns, disabled }: InvoiceFormProps) {
  const [picked, setPicked] = useState("");
  const [taxYear, setTaxYear] = useState(String(year));
  const [due, setDue] = useState("");
  const [include, setInclude] = useState<"yes" | "no">("yes");
  const [charges, setCharges] = useState<Charge[]>([{ label: "", amount: "" }]);

  const name = clientName ?? clients?.find((c) => c.id === picked)?.name ?? "";
  const lines = [
    ...(include === "yes" ? standard.map((l) => ({ label: l.label, cents: l.amount_cents as number | null })) : []),
    ...charges.filter((c) => c.label.trim() || c.amount.trim()).map((c) => ({ label: c.label.trim() || "Charge", cents: parseMoney(c.amount) })),
  ];
  const total = lines.reduce((n, l) => n + (l.cents ?? 0), 0);
  const set = (i: number, patch: Partial<Charge>) => setCharges((cs) => cs.map((c, n) => (n === i ? { ...c, ...patch } : c)));

  return (
    <form action={createInvoiceAction} className="ni-grid">
      <div className="monarch-form ni-fields">
        <input type="hidden" name="back" value={back} />
        {clientId ? <input type="hidden" name="client_id" value={clientId} /> : (
          <label className="is-wide">Client *<select name="client_id" required value={picked} onChange={(e) => setPicked(e.target.value)}><option value="" disabled>{clients?.length ? "Choose a client…" : "Add a client first"}</option>{(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        )}
        <label>Tax year *<input name="tax_year" required inputMode="numeric" maxLength={4} value={taxYear} onChange={(e) => setTaxYear(e.target.value)} /></label>
        <label>Due date<input name="due_on" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        {returns && returns.length > 0 && <label>Which return is this for?<select name="return_id" defaultValue=""><option value="">No specific return</option>{returns.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>}
        <label>Status<select name="status" defaultValue="sent"><option value="sent">Sent</option><option value="draft">Draft</option></select></label>

        <fieldset className="is-wide ni-standard">
          <legend>Standard fees · {usd(standard.reduce((n, l) => n + l.amount_cents, 0))}</legend>
          <ul>{standard.map((l, i) => <li key={i}><span>{l.label}</span><b>{usd(l.amount_cents)}</b></li>)}</ul>
          <div className="ni-choice">
            <label className="monarch-check"><input type="radio" name="include_standard" value="yes" checked={include === "yes"} onChange={() => setInclude("yes")} /> Include</label>
            <label className="monarch-check"><input type="radio" name="include_standard" value="no" checked={include === "no"} onChange={() => setInclude("no")} /> Don&apos;t include</label>
            <Link className="monarch-link" href="/settings/invoice-fees">Change in Settings</Link>
          </div>
        </fieldset>

        <fieldset className="is-wide ni-charges">
          <legend>Other charges</legend>
          {charges.map((c, i) => (
            <div key={i} className="ni-charge">
              <label>What it&apos;s for<input name={`line_label_${i}`} value={c.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="For example, Rush fee" maxLength={120} /></label>
              <label>Amount<FormattedInput kind="money" name={`line_amount_${i}`} value={c.amount} onValue={(v) => set(i, { amount: v })} placeholder="$0.00" /></label>
              {charges.length > 1 ? <button type="button" className="monarch-link ni-out" aria-label={`Take out charge ${i + 1}`} onClick={() => setCharges((cs) => cs.filter((_, n) => n !== i))}>Take out</button> : <span />}
            </div>
          ))}
          {charges.length < MAX_CHARGES && <button type="button" className="monarch-secondary ni-add" onClick={() => setCharges((cs) => [...cs, { label: "", amount: "" }])}>Add another charge</button>}
        </fieldset>
        <label className="is-wide">Notes<input name="notes" maxLength={1000} /></label>
        <div className="is-wide ac-actions"><button className="monarch-primary" disabled={disabled || lines.length === 0}>Create invoice</button></div>
      </div>

      <aside className="ni-preview" aria-label="Invoice preview">
        <div className="ni-sheet">
          <div className="ni-sheet-head"><b>{office}</b><span>INVOICE</span></div>
          <dl className="ni-meta">
            <div><dt>Bill to</dt><dd>{name || "Choose a client"}</dd></div>
            <div><dt>Tax year</dt><dd>{taxYear || "—"}</dd></div>
            <div><dt>Due</dt><dd>{due ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${due}T00:00:00Z`)) : "On receipt"}</dd></div>
          </dl>
          <table>
            <thead><tr><th>Description</th><th>Amount</th></tr></thead>
            <tbody>
              {lines.length === 0 ? <tr><td colSpan={2} className="monarch-muted">Nothing on this invoice yet</td></tr> : lines.map((l, i) => <tr key={i}><td>{l.label}</td><td>{l.cents === null ? <span className="wb-late">check amount</span> : usd(l.cents)}</td></tr>)}
            </tbody>
            <tfoot><tr><th>Total</th><th>{usd(total)}</th></tr></tfoot>
          </table>
        </div>
      </aside>
    </form>
  );
}
