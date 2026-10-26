"use client";

import Link from "next/link";
import { useState } from "react";
import { createInvoiceAction } from "@/app/(admin)/workspace/actions";
import { FormattedInput } from "@/components/forms/formatted-input";
import { parseMoney } from "@/lib/fees/engine.ts";
import { PLAN_EVERY, splitPlan, type PlanEvery } from "@/lib/workspace/plan.ts";

export type InvoiceFormProps = {
  /** The older standard fees, used only while no tax software or bank product is set up. */
  standard: { label: string; amount_cents: number }[];
  /** The tax software and bank products from Settings, with the fees each charges. */
  products: { id: string; kind: "software" | "bank"; name: string; lines: { label: string; amount_cents: number }[] }[];
  taxPercent: number;
  /** The top and bottom of the invoice, from Firm profile, Branding and Invoice settings. */
  header: { name: string; logoUrl: string | null; address: string | null; phone: string | null; email: string | null };
  footer: { refund: string | null; terms: string | null };
  back: string;
  year: number;
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
export function NewInvoiceForm({ standard, products, taxPercent, header, footer, back, year, clientId, clientName, clients, returns, disabled }: InvoiceFormProps) {
  const [picked, setPicked] = useState("");
  const [taxYear, setTaxYear] = useState(String(year));
  const [due, setDue] = useState("");
  const [include, setInclude] = useState<"yes" | "no">("yes");
  const softwareList = products.filter((p) => p.kind === "software");
  const bankList = products.filter((p) => p.kind === "bank");
  // With just one of a kind it is picked for you.
  const [softwareId, setSoftwareId] = useState(softwareList.length === 1 ? softwareList[0].id : "");
  const [bankId, setBankId] = useState(bankList.length === 1 ? bankList[0].id : "");
  const [planCount, setPlanCount] = useState(1);
  const [planFirst, setPlanFirst] = useState("");
  const [planEvery, setPlanEvery] = useState<PlanEvery>("month");
  const [payerPick, setPayerPick] = useState<"bank_product" | "self" | null>(null);
  const [charges, setCharges] = useState<Charge[]>([{ label: "", amount: "" }]);

  const name = clientName ?? clients?.find((c) => c.id === picked)?.name ?? "";
  const software = softwareList.find((p) => p.id === softwareId);
  const bank = bankList.find((p) => p.id === bankId);
  const standardLines = products.length === 0 ? standard : [...(software?.lines ?? []), ...(bank?.lines ?? [])];
  const payer = payerPick ?? (include === "yes" && bank ? "bank_product" : "self");
  const lines = [
    ...(include === "yes" ? standardLines.map((l) => ({ label: l.label, cents: l.amount_cents as number | null })) : []),
    ...charges.filter((c) => c.label.trim() || c.amount.trim()).map((c) => ({ label: c.label.trim() || "Charge", cents: parseMoney(c.amount) })),
  ];
  const subtotal = lines.reduce((n, l) => n + (l.cents ?? 0), 0);
  const tax = Math.round((subtotal * taxPercent) / 100);
  const total = subtotal + tax;
  const schedule = planCount > 1 && /^\d{4}-\d{2}-\d{2}$/.test(planFirst) && total > 0 ? splitPlan(total, planCount, planFirst, planEvery) : [];
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
          <legend>Standard fees · {usd(standardLines.reduce((n, l) => n + l.amount_cents, 0))}</legend>
          {products.length > 0 && (
            <div className="monarch-form">
              {softwareList.length > 0 && <label>Tax software<select name="software_id" value={softwareId} onChange={(e) => setSoftwareId(e.target.value)}>{softwareList.length > 1 && <option value="">Choose…</option>}{softwareList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
              {bankList.length > 0 && <label>Bank product<select name="bank_id" value={bankId} onChange={(e) => setBankId(e.target.value)}>{bankList.length > 1 && <option value="">Choose…</option>}{bankList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
            </div>
          )}
          <ul>{standardLines.map((l, i) => <li key={i}><span>{l.label}</span><b>{usd(l.amount_cents)}</b></li>)}</ul>
          <div className="ni-choice">
            <label className="monarch-check"><input type="radio" name="include_standard" value="yes" checked={include === "yes"} onChange={() => setInclude("yes")} /> Include</label>
            <label className="monarch-check"><input type="radio" name="include_standard" value="no" checked={include === "no"} onChange={() => setInclude("no")} /> Don&apos;t include</label>
            <Link className="monarch-link" href="/settings/billing">Change in Settings</Link>
          </div>
        </fieldset>

        <fieldset className="is-wide ni-choice">
          <legend>Paid by</legend>
          <label className="monarch-check"><input type="radio" name="payer" value="bank_product" checked={payer === "bank_product"} onChange={() => setPayerPick("bank_product")} /> Bank product</label>
          <label className="monarch-check"><input type="radio" name="payer" value="self" checked={payer === "self"} onChange={() => setPayerPick("self")} /> Out of pocket</label>
        </fieldset>

        <fieldset className="is-wide ni-plan">
          <legend>Payment plan</legend>
          <label>Payments<select name="plan_count" value={planCount} onChange={(e) => setPlanCount(Number(e.target.value))}><option value={1}>Pay in full</option>{Array.from({ length: 11 }, (_, n) => n + 2).map((n) => <option key={n} value={n}>{n} payments</option>)}</select></label>
          {planCount > 1 && (
            <>
              <label>First payment due<input name="plan_first_due" type="date" required value={planFirst} onChange={(e) => setPlanFirst(e.target.value)} /></label>
              <label>How often<select name="plan_every" value={planEvery} onChange={(e) => setPlanEvery(e.target.value as PlanEvery)}>{Object.entries(PLAN_EVERY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            </>
          )}
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
          <div className="ni-sheet-head">
            <span className="ni-from">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {header.logoUrl && <img src={header.logoUrl} alt="" style={{ maxHeight: 40, maxWidth: 160, objectFit: "contain" }} />}
              <b>{header.name}</b>
              {[header.address, [header.phone, header.email].filter(Boolean).join(" · ")].filter(Boolean).map((l, i) => <small key={i} className="monarch-muted" style={{ whiteSpace: "pre-line" }}>{l}</small>)}
            </span>
            <span>INVOICE</span>
          </div>
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
            <tfoot>
              {taxPercent > 0 && <><tr><td>Subtotal</td><td>{usd(subtotal)}</td></tr><tr><td>Sales tax ({taxPercent}%)</td><td>{usd(tax)}</td></tr></>}
              <tr><th>Total</th><th>{usd(total)}</th></tr>
            </tfoot>
          </table>
          {schedule.length > 0 && (
            <div className="ni-pays">
              <b>Payment plan</b>
              <ul>{schedule.map((p) => <li key={p.position}><span>Payment {p.position} · due {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${p.due_on}T00:00:00Z`))}</span><b>{usd(p.amount_cents)}</b></li>)}</ul>
            </div>
          )}
          {(footer.refund || footer.terms) && (
            <div className="ni-foot">
              {footer.refund && <p><b>Refund policy</b><br />{footer.refund}</p>}
              {footer.terms && <p><b>Terms and conditions</b><br />{footer.terms}</p>}
            </div>
          )}
        </div>
      </aside>
    </form>
  );
}
