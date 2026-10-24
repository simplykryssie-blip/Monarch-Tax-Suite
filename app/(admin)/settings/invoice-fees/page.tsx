import { requireAdmin } from "@/lib/admin";
import { Flash, PageTitle } from "@/components/admin/ui";
import { dollars, invoiceTotal } from "@/lib/workspace/rules.ts";
import { standardFees } from "@/lib/workspace/service.ts";
import { workspaceLoad, workspaceRepo } from "@/lib/workspace/load";
import { saveStandardFeesAction } from "../../workspace/actions";
import { WorkspaceSetup } from "../../workspace/setup";

const ROWS = 8;

/** The standard fees every new invoice starts from. They are changed here, not on an invoice. */
export default async function InvoiceFeesPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const result = await workspaceLoad(async () => standardFees(workspaceRepo()));
  const lines = result.ok ? result.data : [];
  return (
    <>
      <PageTitle title="Invoice fees">The fees every new invoice starts from. On an invoice you can include them or not; they can only be changed here.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <WorkspaceSetup message={result.message} /> : (
        <form action={saveStandardFeesAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
          <h2 className="is-wide">Standard fees · {dollars(invoiceTotal(lines))}</h2>
          <fieldset className="is-wide">
            {Array.from({ length: ROWS }, (_, n) => lines[n] ?? { label: "", amount_cents: 0 }).map((l, n) => (
              <span key={n} className="ni-line">
                <input name={`line_label_${n}`} defaultValue={l.label} placeholder="Description" aria-label={`Fee ${n + 1} description`} maxLength={120} />
                <input name={`line_amount_${n}`} defaultValue={l.label ? (l.amount_cents / 100).toFixed(2) : ""} placeholder="Amount" aria-label={`Fee ${n + 1} amount`} size={10} />
              </span>
            ))}
          </fieldset>
          <div className="is-wide"><button className="monarch-primary">Save</button></div>
        </form>
      )}
    </>
  );
}
