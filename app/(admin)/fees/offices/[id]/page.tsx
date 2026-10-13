import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { ActionForm } from "../../../efin/action-form";
import { dollars, MONTHS, periodLabel, STATUS_LABEL, yearParam } from "@/lib/fees/engine.ts";
import { feesDeps } from "@/lib/fees/server";
import { scheduleFor, statementFor } from "@/lib/fees/service.ts";
import { markPaidAction, recordReturnAction, setOverrideAction } from "../../actions";
import { FeesNav, UUID } from "../../parts";

type Params = { year?: string; month?: string; status?: string; notice?: string; error?: string };

export default async function OfficeStatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const year = yearParam(sp.year);
  const month = Number(sp.month) >= 1 && Number(sp.month) <= 12 ? Number(sp.month) : null;
  const deps = feesDeps();
  const result = await load(async () => {
    const office = (await deps.repo.listOffices()).find((o) => o.id === id);
    if (!office) return null;
    const [statement, schedule, banks] = await Promise.all([statementFor(deps, id, { taxYear: year, month }), scheduleFor(deps, id), deps.repo.listBanks()]);
    return { office, statement, schedule, banks };
  });
  if (result.ok && !result.data) notFound();
  const here = `/fees/offices/${id}?year=${year}${month ? `&month=${month}` : ""}`;
  return (
    <>
      <PageTitle title={result.ok && result.data ? result.data.office.name : "Office"} back={{ href: `/fees?year=${year}`, label: "Fees & Statements" }}>The office&apos;s statement: every return with the fees it was charged, what&apos;s been collected, and the balance.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      <FeesNav active="overview" />
      {!result.ok ? <SetupRequired message={result.message} /> : (() => {
        const { office, statement: s, schedule, banks } = result.data!;
        const bankName = (b: string | null) => (b ? banks.find((x) => x.id === b)?.name ?? "Bank product" : "None");
        const rows = s.lines.filter((l) => !sp.status || l.status === sp.status);
        const exportQs = `year=${year}${month ? `&month=${month}` : ""}`;
        return (
          <div className="efin-flow">
            <form method="get" action={`/fees/offices/${id}`} className="efin-filter">
              <label className="fees-inline">Tax year<input name="year" defaultValue={year} inputMode="numeric" className="fees-order" /></label>
              <label className="fees-inline">Period
                <select name="month" defaultValue={month ? String(month) : ""}><option value="">Whole season</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
              </label>
              <label className="fees-inline">Status
                <select name="status" defaultValue={sp.status ?? ""}><option value="">All</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </label>
              <button className="monarch-secondary efin-small">Show</button>
              <a className="monarch-secondary efin-small" href={`/fees/offices/${id}/statement?${exportQs}&format=pdf`}>Statement PDF</a>
              <a className="monarch-secondary efin-small" href={`/fees/offices/${id}/statement?${exportQs}&format=csv`}>CSV</a>
            </form>

            <div className="monarch-metrics">
              <div className="monarch-metric"><div>Fees owed · {s.totals.returns} returns</div><strong>{dollars(s.totals.owed)}</strong></div>
              <div className="monarch-metric"><div>Collected</div><strong>{dollars(s.totals.collected)}</strong></div>
              <div className="monarch-metric"><div>Balance{s.totals.owedByEro ? ` · ${dollars(s.totals.owedByEro)} owed by ERO` : ""}</div><strong>{dollars(s.totals.balance)}</strong></div>
            </div>

            <section className="monarch-panel">
              <div className="monarch-panel-head"><div><h2>Returns · {periodLabel(s.period)}</h2><p>Returns without a bank product are owed by the ERO; mark them paid when the ERO pays. Bank-product returns are paid from bank imports.</p></div></div>
              <div className="monarch-table-wrap"><table>
                <thead><tr><th>RETURN</th><th>TAXPAYER</th><th>FILED</th><th>BANK PRODUCT</th><th>FEES</th><th>COLLECTED</th><th>BALANCE</th><th>STATUS</th><th></th></tr></thead>
                <tbody>
                  {rows.length === 0 ? <EmptyRow colSpan={9}>No returns in this period. Record one below or import them.</EmptyRow> : rows.map((l) => (
                    <tr key={l.ret.id}>
                      <td><Link href={`/fees/returns/${l.ret.id}`}><b>{l.ret.return_ref}</b></Link></td>
                      <td>{l.ret.taxpayer_name}</td>
                      <td>{l.ret.filed_on ?? "—"}</td>
                      <td>{bankName(l.ret.bank_option_id)}</td>
                      <td>{dollars(l.owed)}</td>
                      <td>{dollars(l.collected)}</td>
                      <td><b>{dollars(l.balance)}</b></td>
                      <td><Badge value={l.status} /></td>
                      <td>
                        {l.balance > 0 && !l.ret.bank_option_id && (
                          <ActionForm action={markPaidAction} confirm={`Mark return ${l.ret.return_ref} paid (${dollars(l.balance)})?`}>
                            <input type="hidden" name="id" value={l.ret.id} /><input type="hidden" name="back" value={here} />
                            <input type="hidden" name="amount" value="" /><input type="hidden" name="date" value="" /><input type="hidden" name="reference" value="" /><input type="hidden" name="note" value="" />
                            <button className="monarch-secondary efin-small">Mark paid</button>
                          </ActionForm>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              {s.byFee.length > 0 && <p className="monarch-muted" style={{ padding: "0 20px 16px" }}>{s.byFee.map((f) => `${f.label}: ${dollars(f.amount)} (${f.count})`).join(" · ")}</p>}
            </section>

            <section className="monarch-panel">
              <div className="monarch-panel-head"><div><h2>This office&apos;s fees</h2><p>Leave a fee on the bureau amount, or set this office&apos;s own amount ($0 means the office isn&apos;t charged it). Changes apply to returns recorded from now on.</p></div><Link className="monarch-secondary efin-small" href="/fees/schedule">Bureau schedule</Link></div>
              <div className="monarch-table-wrap"><table>
                <thead><tr><th>FEE</th><th>BUREAU</th><th>THIS OFFICE</th><th></th></tr></thead>
                <tbody>
                  {schedule.defaults.length === 0 ? <EmptyRow colSpan={4}>No bureau fees yet. <Link href="/fees/schedule">Set up the schedule</Link>.</EmptyRow> : schedule.defaults.map((d) => {
                    const own = schedule.overrides.find((o) => o.code === d.code);
                    return (
                      <tr key={d.id}>
                        <td><b>{d.label}</b>{d.applies === "bank_product" && <div className="monarch-muted">Bank product · {d.bank_option_id ? bankName(d.bank_option_id) : "any bank"}</div>}</td>
                        <td>{dollars(d.amount_cents)}</td>
                        <td>
                          <ActionForm action={setOverrideAction} className="efin-actions">
                            <input type="hidden" name="office_id" value={office.id} /><input type="hidden" name="code" value={d.code} /><input type="hidden" name="back" value={here} />
                            <input name="amount" defaultValue={own ? (own.amount_cents / 100).toFixed(2) : ""} placeholder="Bureau amount" inputMode="decimal" aria-label={`${d.label} for this office`} className="fees-amount" />
                            <button className="monarch-secondary efin-small">Save</button>
                          </ActionForm>
                        </td>
                        <td>{own && (
                          <ActionForm action={setOverrideAction}>
                            <input type="hidden" name="office_id" value={office.id} /><input type="hidden" name="code" value={d.code} /><input type="hidden" name="clear" value="yes" /><input type="hidden" name="back" value={here} />
                            <button className="monarch-secondary efin-small">Use bureau amount</button>
                          </ActionForm>
                        )}</td>
                      </tr>
                    );
                  })}
                  {schedule.overrides.filter((o) => !schedule.defaults.some((d) => d.code === o.code)).map((o) => (
                    <tr key={o.id}><td><b>{o.label}</b><div className="monarch-muted">This office only</div></td><td>—</td><td>{dollars(o.amount_cents)}</td><td></td></tr>
                  ))}
                </tbody>
              </table></div>
            </section>

            <section className="monarch-panel">
              <div className="monarch-panel-head"><div><h2>Record a return</h2><p>For returns entered by hand. To add many at once, <Link href={`/fees/import?office=${office.id}`}>import a CSV</Link>.</p></div></div>
              <ActionForm action={recordReturnAction} className="monarch-form">
                <input type="hidden" name="office_id" value={office.id} /><input type="hidden" name="back" value={here} />
                <label>Return reference<input name="return_ref" required maxLength={80} placeholder="The tax software's return ID" /></label>
                <label>Taxpayer name<input name="taxpayer_name" required maxLength={200} /></label>
                <label>Tax year<input name="tax_year" required defaultValue={year} inputMode="numeric" /></label>
                <label>Bank product<select name="bank_id" defaultValue=""><option value="">None (owed by the ERO)</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
                <label>Filed date<input name="filed_on" type="date" /></label>
                <label>Funded date<input name="funded_on" type="date" /></label>
                <label className="is-wide">Notes<input name="notes" maxLength={2000} /></label>
                <div className="is-wide"><button className="monarch-primary">Record return</button></div>
              </ActionForm>
            </section>
          </div>
        );
      })()}
    </>
  );
}
