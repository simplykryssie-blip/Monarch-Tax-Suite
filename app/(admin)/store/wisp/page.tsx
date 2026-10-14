import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { currentTenantId } from "@/lib/tenants";
import { wispDeps } from "@/lib/wisp/server";
import type { WispPlan } from "@/lib/wisp/service.ts";
import { Badge, EmptyRow, Flash, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { adminResendWispAction } from "./actions";

const STATUS: Record<WispPlan["status"], string> = { draft: "Not paid (lead)", paid: "Paid, preparing", generated: "Paid, ready" };

/** WISP Generator: paid plans with their delivery, unpaid builder leads, and audit leads. */
export default async function WispAdminPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const result = await load(async () => {
    const deps = wispDeps(currentTenantId());
    const [plans, audits] = await Promise.all([deps.repo.listPlans({ limit: 200 }), deps.repo.listAudits(200)]);
    return { plans, audits };
  });
  return (
    <>
      <PageTitle title="WISP Generator">Free audits, builder leads and paid WISPs. Public page: <Link href="/wisp" target="_blank">/wisp</Link>.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : (
        <>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><h2>WISPs</h2><span>{result.data.plans.filter((p) => p.status !== "draft").length} paid · {result.data.plans.filter((p) => p.status === "draft").length} unpaid leads</span></div>
            <div className="monarch-table-wrap">
              <table>
                <thead><tr><th>STARTED</th><th>FIRM</th><th>EMAIL</th><th>STATUS</th><th>EMAIL DELIVERY</th><th /></tr></thead>
                <tbody>
                  {result.data.plans.length === 0 ? <EmptyRow colSpan={6}>No one has reached the builder&apos;s last step yet.</EmptyRow> : result.data.plans.map((p) => (
                    <tr key={p.id}>
                      <td>{when(p.created_at)}</td>
                      <td><b>{p.firm_name}</b>{p.customer_id && <small className="monarch-subcell"><Link href={`/customers/${p.customer_id}`}>Customer</Link>{p.order_id && <> · <Link href={`/orders/${p.order_id}`}>Order</Link></>}</small>}</td>
                      <td>{p.email}</td>
                      <td><Badge value={p.status === "draft" ? "pending" : p.status === "generated" ? "delivered" : "in_progress"} /><small className="monarch-subcell">{STATUS[p.status]}</small></td>
                      <td>{p.status === "draft" ? "—" : p.emailed_at ? `Sent ${when(p.emailed_at)}` : p.email_error ? <span title={p.email_error}>Not sent: {p.email_error.slice(0, 80)}</span> : "Not yet"}</td>
                      <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {p.status !== "draft" && p.pdf_path && <a className="monarch-secondary" href={`/store/wisp/download/${p.id}`}>Download</a>}
                        {p.status !== "draft" && <form action={adminResendWispAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value="/store/wisp" /><button className="monarch-secondary">{p.emailed_at ? "Email again" : "Send now"}</button></form>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><h2>Audit leads</h2><span>{result.data.audits.length} most recent</span></div>
            <p className="monarch-muted" style={{ padding: "0 20px" }}>Every finished free audit, whether or not they went on to build. Every visitor gives their name, email and phone before the audit starts, and is added to <Link href="/leads?source=wisp_audit">Leads</Link>.</p>
            <div className="monarch-table-wrap">
              <table>
                <thead><tr><th>WHEN</th><th>SCORE</th><th>ERO?</th><th>BUREAU</th><th>PAYS / RETURN</th><th>VOLUME</th></tr></thead>
                <tbody>
                  {result.data.audits.length === 0 ? <EmptyRow colSpan={6}>No audits yet.</EmptyRow> : result.data.audits.map((a) => (
                    <tr key={a.id}>
                      <td>{when(a.created_at)}</td>
                      <td><b>{a.score}</b>/100</td>
                      <td>{a.ero_answers.is_ero ?? "—"}</td>
                      <td>{a.ero_answers.bureau ?? "—"}</td>
                      <td>{a.ero_answers.per_return_fee ? `$${a.ero_answers.per_return_fee}` : "—"}</td>
                      <td>{a.ero_answers.volume ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
