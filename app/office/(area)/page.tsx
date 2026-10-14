import Link from "next/link";
import { requireOffice, officeDeps } from "@/lib/office/server";
import { can, FEATURES } from "@/lib/office/permissions.ts";
import { dollars, yearParam } from "@/lib/fees/engine.ts";
import { feesDeps } from "@/lib/fees/server";
import { statementFor } from "@/lib/fees/service.ts";
import { complianceDeps } from "@/lib/compliance/server";
import { officeStatus } from "@/lib/compliance/service.ts";
import { officeAlerts } from "@/lib/compliance/rules.ts";
import { Alerts } from "./compliance/parts";

export default async function OfficeHome() {
  const ctx = await requireOffice();
  const year = yearParam(undefined);
  const showFees = can(ctx.role, ctx.permissions, "fees.view");
  const showTeam = can(ctx.role, ctx.permissions, "team.manage");
  const showCompliance = can(ctx.role, ctx.permissions, "compliance.home");
  const [statement, members, compliance] = await Promise.all([
    showFees ? statementFor(feesDeps(ctx.tenantId), ctx.office.id, { taxYear: year, month: null }).catch(() => null) : null,
    showTeam ? officeDeps(ctx.tenantId).repo.listMembers(ctx.office.id).catch(() => []) : [],
    // Compliance alerts never stop the dashboard from loading (for example, before the compliance migration).
    showCompliance ? officeStatus(complianceDeps(ctx.tenantId), ctx.office.id).then((st) => officeAlerts(st)).catch(() => null) : null,
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
      {compliance && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Compliance</h2>
          <Alerts alerts={compliance} />
        </section>
      )}
      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>Your office</h2><p>What you can open from here. Your service bureau and your ERO decide what each account can reach.</p></div></div>
        <ul className="office-cards">
          {showCompliance && <li><Link href="/office/compliance"><b>Compliance Center</b><span>WISP attestation and acknowledgments, Form 8879 records, PTIN renewal, incident response and the document vault.</span></Link></li>}
          {showFees && <li><Link href="/office/statement"><b>Fees &amp; statement</b><span>Every return&apos;s fees, what&apos;s been collected, and the balance. Download it as PDF or CSV.</span></Link></li>}
          {showTeam && <li><Link href="/office/team"><b>Team &amp; permissions</b><span>{members.filter((m) => m.status === "active").length} active, {members.filter((m) => m.status === "invited").length} invited. Invite preparers and choose what each one can reach.</span></Link></li>}
          {soon.map((f) => <li key={f.key} className="is-soon"><div><b>{f.label}</b><span>{f.note ?? "Coming in a later update."}</span></div></li>)}
        </ul>
      </section>
    </>
  );
}
