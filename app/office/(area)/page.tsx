import Link from "next/link";
import { requireOffice, officeDeps } from "@/lib/office/server";
import { can, FEATURES } from "@/lib/office/permissions.ts";
import { dollars, yearParam } from "@/lib/fees/engine.ts";
import { feesDeps } from "@/lib/fees/server";
import { statementFor } from "@/lib/fees/service.ts";

export default async function OfficeHome() {
  const ctx = await requireOffice();
  const year = yearParam(undefined);
  const showFees = can(ctx.role, ctx.permissions, "fees.view");
  const showTeam = can(ctx.role, ctx.permissions, "team.manage");
  const [statement, members] = await Promise.all([
    showFees ? statementFor(feesDeps(ctx.tenantId), ctx.office.id, { taxYear: year, month: null }).catch(() => null) : null,
    showTeam ? officeDeps(ctx.tenantId).repo.listMembers(ctx.office.id).catch(() => []) : [],
  ]);
  const soon = FEATURES.filter((f) => f.status === "soon" && can(ctx.role, ctx.permissions, f.key));
  return (
    <>
      <h1 className="office-h1">{can(ctx.role, ctx.permissions, "office.dashboard") ? "Office dashboard" : "Home"}</h1>
      {statement && (
        <div className="monarch-metrics">
          <div className="monarch-metric"><div>Fees owed · tax year {year}</div><strong>{dollars(statement.totals.owed)}</strong></div>
          <div className="monarch-metric"><div>Collected</div><strong>{dollars(statement.totals.collected)}</strong></div>
          <div className="monarch-metric"><div>Balance · {statement.totals.returns} returns</div><strong>{dollars(statement.totals.balance)}</strong></div>
        </div>
      )}
      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>Your office</h2><p>What you can open from here. Your service bureau and your ERO decide what each account can reach.</p></div></div>
        <ul className="office-cards">
          {showFees && <li><Link href="/office/statement"><b>Fees &amp; statement</b><span>Every return&apos;s fees, what&apos;s been collected, and the balance. Download it as PDF or CSV.</span></Link></li>}
          {showTeam && <li><Link href="/office/team"><b>Team &amp; permissions</b><span>{members.filter((m) => m.status === "active").length} active, {members.filter((m) => m.status === "invited").length} invited. Invite preparers and choose what each one can reach.</span></Link></li>}
          {soon.map((f) => <li key={f.key} className="is-soon"><div><b>{f.label}</b><span>{f.note ?? "Coming in a later update."}</span></div></li>)}
        </ul>
      </section>
    </>
  );
}
