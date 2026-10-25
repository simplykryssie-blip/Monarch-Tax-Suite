import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { EmptyRow, PageTitle } from "@/components/admin/ui";
import { complianceDeps } from "@/lib/compliance/server";
import { officeStatus } from "@/lib/compliance/service.ts";
import { longDate, ptinSeason, todayIso } from "@/lib/compliance/rules.ts";
import { chooseOfficeAction } from "@/app/office/actions";

/**
 * Compliance status across every office: attested or overdue, acknowledgments, PTIN renewals, open incidents, 8879
 * retention and the office's own checklist. Status only: the bureau doesn't see vault files or 8879 records.
 */
export default async function BureauCompliance() {
  await requireAdmin();
  const deps = complianceDeps();
  const season = ptinSeason(todayIso());
  let rows: { id: string; name: string; st: Awaited<ReturnType<typeof officeStatus>> }[] = [];
  let problem: string | null = null;
  try {
    const offices = (await deps.repo.listOffices()).filter((o) => !o.archived);
    rows = await Promise.all(offices.map(async (o) => ({ id: o.id, name: o.name, st: await officeStatus(deps, o.id) })));
  } catch (e) {
    problem = e instanceof Error ? e.message.slice(0, 200) : "unknown";
  }
  const wisp = (st: (typeof rows)[number]["st"]) => st.review.state === "none" ? <span className="compliance-overdue">Not attested</span>
    : st.review.state === "overdue" ? <span className="compliance-overdue">Overdue since {longDate(st.review.due!)}</span>
    : st.review.state === "due_soon" ? <span className="compliance-due_soon">Review due {longDate(st.review.due!)}</span>
    : <>Attested · review {longDate(st.review.due!)}</>;
  return (
    <>
      <PageTitle title="Compliance">Each office&apos;s compliance status at a glance. You see status only: offices&apos; vault files and Form 8879 records stay with the office. Open an office to see its Compliance Center the way its team does.</PageTitle>
      {problem ? (
        <div className="monarch-notice"><b>NOT SET UP YET</b> This part of your account isn&apos;t ready yet. Please contact support and we&apos;ll finish setting it up. Nothing else is affected. </div>
      ) : (
        <section className="monarch-panel">
          <div className="monarch-panel-head"><h2>Offices</h2><span>{rows.length} active</span></div>
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>OFFICE</th><th>WISP</th><th>ACKNOWLEDGED</th><th>PTIN {season.renewalYear}</th><th>OPEN INCIDENTS</th><th>8879 RETENTION</th><th>CHECKLIST</th><th /></tr></thead>
            <tbody>{rows.length === 0 ? <EmptyRow colSpan={8}>No offices yet. Each firm in My Service Bureau is an office.</EmptyRow> : rows.map(({ id, name, st }) => (
              <tr key={id}>
                <td><b>{name}</b></td>
                <td>{wisp(st)}</td>
                <td>{st.review.state === "none" ? "—" : `${st.acks.done} of ${st.acks.of}`}</td>
                <td>{st.ptin.of ? `${st.ptin.renewed} of ${st.ptin.of} renewed` : "No team yet"}</td>
                <td>{st.incidents.open ? <span className="compliance-overdue">{st.incidents.open}{st.incidents.ftcOverdue ? ` · ${st.incidents.ftcOverdue} past FTC deadline` : ""}</span> : "None"}</td>
                <td>{st.records8879.total} records{st.records8879.ending ? ` · ${st.records8879.ending} ending soon` : ""}{st.records8879.past ? ` · ${st.records8879.past} past` : ""}</td>
                <td>{st.items.overdue ? <span className="compliance-overdue">{st.items.overdue} overdue</span> : st.items.dueSoon ? `${st.items.dueSoon} due soon` : "Up to date"}</td>
                <td><form action={chooseOfficeAction}><input type="hidden" name="office_id" value={id} /><button className="monarch-secondary efin-small">Open office</button></form></td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
      <p className="monarch-muted" style={{ padding: "0 4px" }}>Offices invite their team from <Link href="/offices">Office access</Link>.</p>
    </>
  );
}
