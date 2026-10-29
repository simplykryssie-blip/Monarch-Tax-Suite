import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { Badge, money, PageTitle, when } from "@/components/admin/ui";
import { AppointmentsCard } from "@/components/contacts/appointments-card";
import { AssignTo } from "@/components/contacts/assign-to";
import { listStaff } from "@/lib/staff/server";
import { staffLabel } from "@/lib/staff/assign.ts";
import { describeLeadEvent } from "@/lib/leads/history.ts";
import { SETTABLE_STATUSES } from "@/lib/leads/service.ts";
import { LEAD_STATUSES, sourceName } from "@/lib/leads/types.ts";
import { recordCounts } from "@/lib/contacts/record-counts.ts";
import { workspaceRepo } from "@/lib/workspace/server";
import { TagInput } from "../../leads/tag-input";
import { leadsDeps } from "@/lib/leads/server";
import { convertLeadAction } from "../convert-actions";
import { saveLeadNotesAction, setLeadStatusAction } from "../lead-notes-actions";
import { DuplicateCompare } from "@/components/contacts/duplicate-compare";
import { contactForKey, DUPLICATE_REASON, parseContactKey, type Contact } from "@/lib/contacts/combine.ts";
import { loadContacts } from "@/lib/contacts/server";
import { allows } from "@/lib/tier.ts";
import { currentTier } from "@/lib/tier-server";

// One person, wherever they are kept. Read-only: it shows which records are combined here and links to each one's own page.
// Sensitive personal details stay on the client's own page, not here.
export default async function ContactPage({ params }: { params: Promise<{ key: string }> }) {
  await requireAdmin();
  const { key } = await params;
  if (!parseContactKey(key)) notFound();
  const data = await loadContacts();
  // A lead who became a client (or shares an email with one) is one contact under the client's key: an older link to the lead's key lands there.
  const parsed = parseContactKey(key)!;
  const contact = contactForKey(data.contacts, key);
  if (!contact) notFound();
  if (contact.key !== key && !contact.refs.clientId) redirect(`/contacts/${contact.key}`);
  // A client's key opens the client's page. A lead's own key still opens the lead, even after it became a client, so its history can be read.
  if (contact.refs.clientId && parsed.kind !== "lead") redirect(`/workspace/clients/${contact.refs.clientId}`);

  const lead = data.leads.find((l) => l.id === (parsed.kind === "lead" ? parsed.id : contact.refs.leadId)) ?? null;
  const client = data.clients.find((c) => c.id === contact.refs.clientId) ?? null;
  const customers = data.customers.filter((c) => contact.refs.customerIds.includes(c.id));
  const orders = data.orders.filter((o) => contact.refs.customerIds.includes(o.customer_id));
  const paid = orders.filter((o) => ["paid", "partially_refunded", "refunded"].includes(o.payment_status));
  const value = paid.reduce((sum, o) => sum + o.amount_cents - o.amount_refunded_cents, 0);
  const byKey = new Map(data.contacts.map((c) => [c.key, c]));
  const related = data.duplicates.filter((d) => d.a === key || d.b === key);
  const counts = new Map(await Promise.all([contact, ...related.map((d) => byKey.get(d.a === key ? d.b : d.a)).filter((c): c is Contact => !!c)].map(async (c) => [c.key, await recordCounts(workspaceRepo(), c, leadsDeps().repo)] as const)));
  const leadFull = lead ? await leadsDeps().repo.getLead(lead.id).catch(() => null) : null;
  const leadEvents = leadFull ? await leadsDeps().repo.listEvents(leadFull.id).catch(() => []) : [];
  const tagOptions = leadFull ? (await leadsDeps().repo.tagCounts().catch(() => [])).map((t) => t.tag) : [];
  const staff = lead ? await listStaff().catch(() => []) : [];

  return (
    <>
      <PageTitle title={contact.name} back={{ href: "/contacts", label: "All contacts" }}>
        {contact.email ?? "No email on file"}{contact.phone ? ` · ${contact.phone}` : ""}
      </PageTitle>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {contact.chips.map((c) => <span key={c.kind} className="monarch-badge" style={{ opacity: c.active ? 1 : 0.6 }}>{c.label}</span>)}
        {contact.tags.map((t) => <span key={t} className="monarch-badge">{t}</span>)}
      </div>

      {leadFull && (
        <section className="cl-strip" aria-label="At a glance">
          <div>
            <small>Status</small>
            {leadFull.status === "converted" ? <b>{LEAD_STATUSES.converted}</b> : (
              <form action={setLeadStatusAction} className="cl-assign">
                <input type="hidden" name="id" value={leadFull.id} /><input type="hidden" name="back" value={`/contacts/${key}`} />
                <select name="status" defaultValue={leadFull.status} aria-label="Status">
                  {SETTABLE_STATUSES.map((st) => <option key={st} value={st}>{LEAD_STATUSES[st]}</option>)}
                </select>
                <button className="monarch-secondary efin-small">Save</button>
              </form>
            )}
          </div>
          <div><small>Source</small><b>{sourceName(leadFull.source)}</b></div>
          <div><small>Lead since</small><b>{when(leadFull.created_at)}</b></div>
          <div><small>Last contacted</small><b>{leadFull.last_contacted_at ? when(leadFull.last_contacted_at) : "Not yet"}</b></div>
          <div><small>Assigned to</small><b>{staffLabel(staff, leadFull.assigned_to ?? null) ?? "No one"}</b></div>
          <div><small>Tags</small><b>{leadFull.tags.length ? leadFull.tags.join(", ") : "None"}</b></div>
        </section>
      )}
      {leadFull && contact.refs.clientId && (
        <p style={{ marginBottom: 14 }}>This lead became a client. <Link className="monarch-link" href={`/workspace/clients/${contact.refs.clientId}`}><b>Open the client record</b></Link></p>
      )}
      {leadFull && !contact.refs.clientId && (
        <form action={convertLeadAction} style={{ marginBottom: 14 }}>
          <input type="hidden" name="id" value={leadFull.id} /><input type="hidden" name="back" value={`/contacts/${key}`} />
          <button className="monarch-primary">Convert to client</button> <small className="monarch-muted">Makes a client record with this lead&apos;s details, tags and notes.</small>
        </form>
      )}
      {lead && <AssignTo kind="lead" id={lead.id} current={lead.assigned_to ?? null} staff={staff} back={`/contacts/${key}`} />}
      <div style={{ marginBottom: 14 }}><AppointmentsCard email={contact.email} /></div>

      <section className="monarch-panel" style={{ marginBottom: 14 }}>
        <div className="monarch-panel-head"><h2>Records combined here</h2></div>
        <p style={{ padding: "0 20px", color: "#77746b", fontSize: 12 }}>One person, one contact. These are the records found for them. Each keeps its own page; nothing has been merged or changed.</p>
        <div className="monarch-table-wrap">
          <table>
            <thead><tr><th>RECORD</th><th>STATUS</th><th>LAST UPDATED</th><th /></tr></thead>
            <tbody>
              {client && <tr><td><b>Client</b></td><td>{client.archived_at ? "Archived" : "Current"}</td><td>{when(client.updated_at)}</td><td><Link href={`/workspace/clients/${client.id}`}>Open client</Link></td></tr>}
              {lead && <tr><td><b>Lead</b><small className="monarch-subcell">from {lead.source}</small></td><td><Badge value={lead.status} /></td><td>{when(lead.updated_at)}</td><td>{allows(await currentTier(), "leads") && <Link href={`/leads/${lead.id}`}>Open lead</Link>}</td></tr>}
              {customers.map((c) => <tr key={c.id}><td><b>Customer</b></td><td><Badge value={c.status} /></td><td>{when(c.updated_at)}</td><td><Link href={`/customers/${c.id}`}>Open customer</Link></td></tr>)}
            </tbody>
          </table>
        </div>
      </section>

      {leadFull && (
        <form action={saveLeadNotesAction} className="monarch-panel monarch-form" style={{ padding: 20, marginBottom: 14 }}>
          <h2 className="is-wide">Notes and tags</h2>
          <input type="hidden" name="id" value={leadFull.id} />
          <input type="hidden" name="back" value={`/contacts/${key}`} />
          <label className="is-wide">Notes<textarea name="notes" rows={6} maxLength={10000} defaultValue={leadFull.notes ?? ""} placeholder="Anything worth remembering about this person." /></label>
          <div className="is-wide"><b>Tags</b><TagInput initial={leadFull.tags} suggestions={tagOptions} /></div>
          <div className="is-wide"><button className="monarch-primary">Save notes and tags</button></div>
        </form>
      )}

      {leadFull && (
        <section className="monarch-panel" style={{ marginBottom: 14 }}>
          <div className="monarch-panel-head"><h2>History</h2></div>
          {leadEvents.length === 0 ? <p className="monarch-muted" style={{ padding: "0 20px 14px" }}>Nothing recorded yet.</p> : (
            <ul className="cl-list" style={{ padding: "0 20px 10px" }}>
              {leadEvents.slice(0, 30).map((e) => (
                <li key={e.id}><span>{describeLeadEvent(e)}<small className="monarch-subcell">{when(e.created_at)}{e.actor_id ? ` · ${staffLabel(staff, e.actor_id) ?? "a teammate"}` : ""}</small></span></li>
              ))}
            </ul>
          )}
        </section>
      )}

      {customers.length > 0 && (
        <section className="monarch-panel" style={{ marginBottom: 14 }}>
          <div className="monarch-panel-head"><h2>Store purchases</h2><span>{orders.length} {orders.length === 1 ? "order" : "orders"} · {money(value, paid[0]?.currency ?? "usd")}</span></div>
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>ORDER</th><th>PLACED</th><th>AMOUNT</th><th>STATUS</th></tr></thead>
              <tbody>
                {orders.length === 0 ? <tr><td colSpan={4}>No orders yet.</td></tr> : orders.map((o) => (
                  <tr key={o.id}><td>#{o.order_number}</td><td>{when(o.created_at)}</td><td>{money(o.amount_cents, o.currency)}</td><td><Badge value={o.payment_status} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section className="monarch-panel">
          <div className="monarch-panel-head"><h2>Might also be the same person</h2></div>
          <div style={{ padding: "0 20px 8px" }}>
            {related.map((d) => {
              const other = byKey.get(d.a === key ? d.b : d.a);
              if (!other) return null;
              const open = (c: Contact) => (c.refs.clientId ? `/workspace/clients/${c.refs.clientId}` : `/contacts/${c.key}`);
              return <DuplicateCompare key={other.key} a={contact} b={other} reason={DUPLICATE_REASON[d.reason]} back={`/contacts/${key}`} openA={open(contact)} openB={open(other)} countsA={counts.get(contact.key)} countsB={counts.get(other.key)} />;
            })}
          </div>
        </section>
      )}
    </>
  );
}
