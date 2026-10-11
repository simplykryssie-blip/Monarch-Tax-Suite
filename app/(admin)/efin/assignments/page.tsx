import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { roleLabel } from "@/lib/efin/rules.ts";
import { loadSnapshot } from "@/lib/efin/service";
import { ASSIGNMENT_STATES } from "@/lib/efin/types.ts";
import { orgName, personName } from "../parts";

export default async function Assignments({ searchParams }: { searchParams: Promise<{ state?: string; notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const result = await load(loadSnapshot);
  return (
    <>
      <PageTitle title="Assignments">Who is assigned to which EFIN, and where each request stands. Open an EFIN to approve, activate, suspend or revoke. A revoked assignment can never be reactivated.</PageTitle>
      <Flash {...sp} />
      {!result.ok ? <SetupRequired message={result.message} /> : (() => {
        const s = result.data;
        const rows = s.assignments.filter((a) => !sp.state || a.state === sp.state);
        return (
          <section className="monarch-panel">
            <div className="monarch-panel-head">
              <div><h2>All assignments</h2><p>Approval is an internal decision. It does not mean the IRS or a software provider has authorized anything.</p></div>
              <div className="mt-seg"><Link href="/efin/assignments" className={!sp.state ? "is-on" : ""}>All</Link>{ASSIGNMENT_STATES.filter((v) => ["pending_review", "active", "suspended", "revoked"].includes(v)).map((v) => <Link key={v} href={`/efin/assignments?state=${v}`} className={sp.state === v ? "is-on" : ""}>{v.replace(/_/g, " ")}</Link>)}</div>
            </div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>EFIN</th><th>ORGANIZATION</th><th>PERSON</th><th>ROLE</th><th>STATE</th><th>REQUESTED</th></tr></thead>
              <tbody>{rows.length === 0 ? <EmptyRow colSpan={6}>No assignments{sp.state ? " in that state" : " yet. Open an EFIN and request one from its Office Assignments tab"}.</EmptyRow> : rows.map((a) => {
                const e = s.efins.find((x) => x.id === a.efin_id);
                return (
                  <tr key={a.id}>
                    <td><Link href={`/efin/${a.efin_id}?tab=assignments`} className="efin-mask">••{e?.efin_last4 ?? "????"}</Link></td>
                    <td>{orgName(s.orgs, a.organization_id)}</td><td>{personName(s.people, a.person_id)}</td><td>{roleLabel(a.role)}</td><td><Badge value={a.state} /></td><td>{a.requested_at.slice(0, 10)}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </section>
        );
      })()}
    </>
  );
}
