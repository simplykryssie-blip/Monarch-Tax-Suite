import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { Flash, money, PageTitle, when } from "@/components/admin/ui";
import { UUID } from "@/lib/leads/service.ts";
import { firmOptions, leadsDeps, linkedRecords } from "@/lib/leads/server";
import { LEAD_STATUSES, type LeadEvent, type LeadStatus } from "@/lib/leads/types.ts";
import { deleteLeadAction, linkFirmAction, markContactedAction, updateLeadAction } from "../actions";
import { LeadFields } from "../fields";
import { dateValue, day, leadsLoad, LeadsSetupRequired, sourceLabel, StatusBadge } from "../parts";

const status = (v: unknown) => (typeof v === "string" && v in LEAD_STATUSES ? LEAD_STATUSES[v as LeadStatus] : String(v ?? ""));

/** One line of the lead's history. */
function eventText(e: LeadEvent): string {
  const d = e.detail;
  switch (e.action) {
    case "created": return d.source !== "wisp_audit" ? "Added" : d.started ? "Started the free WISP audit" : `Took the free WISP audit (score ${d.score}/100)`;
    case "audit_started": return `Started the WISP audit again${typeof d.phone_given === "string" ? ` (gave phone ${d.phone_given})` : ""}`;
    case "imported": return `Imported from a CSV (row ${d.row})`;
    case "audit_taken": return `Finished the WISP audit (score ${d.score}/100)`;
    case "status_changed": return `Status: ${status(d.from)} → ${status(d.to)}`;
    case "contacted": return d.to ? `Contacted (status: ${status(d.from)} → ${status(d.to)})` : "Contacted";
    case "edited": return `Edited: ${(Array.isArray(d.fields) ? d.fields : []).map((f) => String(f).replace(/_/g, " ").replace("full name", "name").replace(" at", "")).join(", ")}`;
    case "converted": return `Bought the ${d.product ?? "product"} — marked Converted`;
    case "firm_linked": return "Linked to a firm";
    case "firm_unlinked": return "Firm unlinked";
    default: return e.action.replace(/_/g, " ");
  }
}

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const result = await leadsLoad(async () => {
    const deps = leadsDeps();
    const lead = await deps.repo.getLead(id);
    if (!lead) return null;
    const [events, firms, linked] = await Promise.all([deps.repo.listEvents(id), firmOptions(), linkedRecords(lead.customer_id, lead.order_id)]);
    return { lead, events, firms, linked };
  });
  if (result.ok && !result.data) notFound();
  if (!result.ok) return <><PageTitle title="Lead" back={{ href: "/leads", label: "Leads" }} /><LeadsSetupRequired message={result.message} /></>;
  const { lead, events, firms, linked } = result.data!;
  const firm = firms.find((f) => f.id === lead.organization_id);
  return (
    <>
      <PageTitle title={lead.full_name} back={{ href: "/leads", label: "Leads" }}>
        {lead.email}{lead.phone ? ` · ${lead.phone}` : ""} · {sourceLabel(lead.source)} · came in {day(lead.created_at)}
      </PageTitle>
      <Flash notice={sp.notice} error={sp.error} />

      <section className="monarch-panel" style={{ padding: 20, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <StatusBadge status={lead.status} />
        <span className="monarch-muted">Last contacted: {day(lead.last_contacted_at)}</span>
        {lead.audit_score !== null && <span className="monarch-muted">WISP audit score: <b>{lead.audit_score}</b>/100</span>}
        <form action={markContactedAction}><input type="hidden" name="id" value={lead.id} /><button className="monarch-secondary">Contacted today</button></form>
        <a className="monarch-secondary" href={`mailto:${lead.email}`}>Email</a>
      </section>

      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2>Journey</h2>
        <p className="monarch-muted">Lead → customer when they buy → firm when they become an ERO.</p>
        <ul className="lead-journey">
          <li><b>Lead</b> since {day(lead.created_at)}</li>
          <li><b>Customer</b>{" "}
            {linked.customer ? <><Link href={`/customers/${linked.customer.id}`}>{linked.customer.full_name ?? linked.customer.email}</Link>{linked.order && <> · <Link href={`/orders/${linked.order.id}`}>order {money(linked.order.amount_cents, linked.order.currency)}</Link></>}{lead.converted_at && <> · converted {day(lead.converted_at)}</>}</>
              : lead.status === "converted" ? <>marked Converted{lead.converted_at ? ` ${day(lead.converted_at)}` : ""} (no purchase linked)</> : "not yet — linked automatically when they buy the WISP"}
          </li>
          <li><b>Firm</b>{" "}
            {firm ? <Link href={`/efin/org/${firm.id}`}>{firm.name}</Link> : "none linked"}
            <form action={linkFirmAction} className="monarch-inline-form" style={{ marginTop: 8, flexWrap: "wrap" }}>
              <input type="hidden" name="id" value={lead.id} />
              <select name="organization_id" defaultValue={lead.organization_id ?? ""} aria-label="Firm">
                <option value="">No firm</option>
                {firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <button className="monarch-secondary">{firm ? "Change firm" : "Link firm"}</button>
              {firms.length === 0 && <small className="monarch-muted">Add the firm in My Service Bureau first.</small>}
            </form>
          </li>
        </ul>
      </section>

      <form action={updateLeadAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
        <h2 className="is-wide">Details</h2>
        <input type="hidden" name="id" value={lead.id} />
        <LeadFields v={{ ...lead, phone: lead.phone ?? "", firm_name: lead.firm_name ?? "", notes: lead.notes ?? "", last_contacted_at: dateValue(lead.last_contacted_at) }} />
        <div className="is-wide"><button className="monarch-primary">Save</button><small className="monarch-muted"> Last changed {when(lead.updated_at)}</small></div>
      </form>

      <section className="monarch-panel">
        <div className="monarch-panel-head"><h2>History</h2></div>
        <div className="monarch-table-wrap">
          <table>
            <thead><tr><th>WHEN</th><th>WHAT</th></tr></thead>
            <tbody>{events.map((e) => <tr key={e.id}><td>{when(e.created_at)}</td><td>{eventText(e)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <form action={deleteLeadAction} className="monarch-panel monarch-inline-form" style={{ padding: 20, flexWrap: "wrap" }}>
        <input type="hidden" name="id" value={lead.id} />
        <label><input type="checkbox" name="confirm" value="yes" required /> Delete this lead and its history (for spam or test entries). Their audit, customer and orders are kept.</label>
        <button className="monarch-secondary is-danger">Delete lead</button>
      </form>
    </>
  );
}
