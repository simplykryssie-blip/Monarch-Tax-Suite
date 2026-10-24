import { loadBrand } from "@/lib/branding/server";
import { documentDeps } from "@/lib/documents/server";
import { Modal } from "@/components/ui/modal";
import { workspaceRepo } from "@/lib/workspace/server";
import { balance, dollars } from "@/lib/workspace/rules.ts";
import { billingSettings } from "@/lib/workspace/service.ts";
import { PAYERS, type Invoice } from "@/lib/workspace/types.ts";

/** The top and bottom of an invoice, from Firm profile, Branding and Invoice settings. Load once per page. */
export type SheetContext = { header: { name: string; logoUrl: string | null; address: string | null; phone: string | null; email: string | null }; footer: { refund: string | null; terms: string | null } };

export async function loadSheetContext(): Promise<SheetContext> {
  const [brand, profile, settings] = await Promise.all([loadBrand().catch(() => null), documentDeps().repo.getProfile().catch(() => null), billingSettings(workspaceRepo())]);
  return {
    header: { name: profile?.display_name || brand?.name || "Your office", logoUrl: brand?.logoUrl ?? null, address: profile?.address ?? null, phone: profile?.phone ?? null, email: profile?.email ?? null },
    footer: { refund: settings.refund_policy, terms: settings.terms },
  };
}

const day = (d: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/** The invoice as the client gets it. */
export function InvoiceSheet({ invoice: i, clientName, ctx }: { invoice: Invoice; clientName: string; ctx: SheetContext }) {
  const { header, footer } = ctx;
  const tax = i.tax_cents ?? 0;
  return (
    <div className="ni-sheet">
      <div className="ni-sheet-head">
        <span className="ni-from">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {header.logoUrl && <img src={header.logoUrl} alt="" style={{ maxHeight: 40, maxWidth: 160, objectFit: "contain" }} />}
          <b>{header.name}</b>
          {[header.address, [header.phone, header.email].filter(Boolean).join(" · ")].filter(Boolean).map((l, n) => <small key={n} className="monarch-muted" style={{ whiteSpace: "pre-line" }}>{l}</small>)}
        </span>
        <span>INVOICE {i.number}</span>
      </div>
      <dl className="ni-meta">
        <div><dt>Bill to</dt><dd>{clientName}</dd></div>
        <div><dt>Tax year</dt><dd>{i.tax_year}</dd></div>
        <div><dt>Issued</dt><dd>{day(i.issued_on)}</dd></div>
        <div><dt>Due</dt><dd>{i.due_on ? day(i.due_on) : "On receipt"}</dd></div>
        {(i.payer || i.software_name || i.bank_name) && <div><dt>Payment type</dt><dd>{i.payer ? PAYERS[i.payer] : "—"}{i.bank_name ? ` · ${i.bank_name}` : ""}{i.software_name ? ` · ${i.software_name}` : ""}</dd></div>}
      </dl>
      <table>
        <thead><tr><th>Description</th><th>Amount</th></tr></thead>
        <tbody>{i.lines.map((l, n) => <tr key={n}><td>{l.label}</td><td>{dollars(l.amount_cents)}</td></tr>)}</tbody>
        <tfoot>
          {tax > 0 && <><tr><td>Subtotal</td><td>{dollars(i.total_cents - tax)}</td></tr><tr><td>Sales tax ({i.tax_percent}%)</td><td>{dollars(tax)}</td></tr></>}
          <tr><th>Total</th><th>{dollars(i.total_cents)}</th></tr>
          {i.paid_cents > 0 && <tr><td>Paid</td><td>−{dollars(i.paid_cents)}</td></tr>}
          {i.status !== "paid" && i.status !== "void" && <tr><th>Balance</th><th>{dollars(balance(i))}</th></tr>}
        </tfoot>
      </table>
      {i.notes && <p className="monarch-muted">{i.notes}</p>}
      {(footer.refund || footer.terms) && (
        <div className="ni-foot">
          {footer.refund && <p><b>Refund policy</b><br />{footer.refund}</p>}
          {footer.terms && <p><b>Terms and conditions</b><br />{footer.terms}</p>}
        </div>
      )}
    </div>
  );
}

/** The invoice number as a button that opens the invoice in a popup. */
export function InvoiceLink({ invoice, clientName, ctx }: { invoice: Invoice; clientName: string; ctx: SheetContext }) {
  return <Modal label={invoice.number} title={`Invoice ${invoice.number}`} className="monarch-link ni-numlink" wide><InvoiceSheet invoice={invoice} clientName={clientName} ctx={ctx} /></Modal>;
}
