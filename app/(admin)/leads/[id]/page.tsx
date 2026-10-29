import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { Flash, PageTitle, when } from "@/components/admin/ui";
import { UUID } from "@/lib/leads/service.ts";
import { leadsDeps } from "@/lib/leads/server";
import { convertLeadAction } from "../../contacts/convert-actions";
import { deleteLeadAction, markContactedAction, updateLeadAction } from "../actions";
import { LeadFields } from "../fields";
import { dateValue, day, leadsLoad, LeadsSetupRequired, sourceLabel, StatusBadge } from "../parts";

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const result = await leadsLoad(async () => {
    const deps = leadsDeps();
    const lead = await deps.repo.getLead(id);
    if (!lead) return null;
    const tags = await deps.repo.tagCounts();
    return { lead, tagOptions: tags.map((t) => t.tag) };
  });
  if (result.ok && !result.data) notFound();
  if (!result.ok) return <><PageTitle title="Lead" back={{ href: "/leads", label: "Leads" }} /><LeadsSetupRequired message={result.message} /></>;
  const { lead, tagOptions } = result.data!;
  return (
    <>
      <PageTitle title={lead.full_name} back={{ href: "/leads", label: "Leads" }}>
        {lead.email}{lead.phone ? ` · ${lead.phone}` : ""}{lead.firm_name ? ` · ${lead.firm_name}` : ""}
        <small className="lead-source">Source: {sourceLabel(lead.source)}</small>
      </PageTitle>
      <Flash notice={sp.notice} error={sp.error} />

      <section className="monarch-panel" style={{ padding: 20, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <StatusBadge status={lead.status} />
        <span className="monarch-muted">Lead since {day(lead.created_at)}</span>
        <span className="monarch-muted">Last contacted: {day(lead.last_contacted_at)}</span>
        {lead.audit_score !== null && <span className="monarch-muted">WISP audit score: <b>{lead.audit_score}</b>/100</span>}
        <form action={markContactedAction}><input type="hidden" name="id" value={lead.id} /><button className="monarch-secondary">Contacted today</button></form>
        <a className="monarch-secondary" href={`mailto:${lead.email}`}>Email</a>
        <form action={convertLeadAction}><input type="hidden" name="id" value={lead.id} /><input type="hidden" name="back" value={`/leads/${lead.id}`} /><button className="monarch-primary" title="Makes a client record from this lead">Convert to client</button></form>
      </section>

      <form action={updateLeadAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
        <h2 className="is-wide">Details</h2>
        <input type="hidden" name="id" value={lead.id} />
        <LeadFields showSource tagOptions={tagOptions} v={{ ...lead, phone: lead.phone ?? "", firm_name: lead.firm_name ?? "", notes: lead.notes ?? "", tags: lead.tags.join(","), last_contacted_at: dateValue(lead.last_contacted_at) }} />
        <div className="is-wide"><button className="monarch-primary">Save</button><small className="monarch-muted"> Last changed {when(lead.updated_at)}</small></div>
      </form>

      <form action={deleteLeadAction} className="monarch-panel monarch-inline-form" style={{ padding: 20, flexWrap: "wrap" }}>
        <input type="hidden" name="id" value={lead.id} />
        <label><input type="checkbox" name="confirm" value="yes" required /> Delete this lead and its history (for spam or test entries). Their audit, customer and orders are kept.</label>
        <button className="monarch-secondary is-danger">Delete lead</button>
      </form>
    </>
  );
}
