import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { Badge, money, PageTitle, when } from "@/components/admin/ui";
import { AppointmentsCard } from "@/components/contacts/appointments-card";
import { AssignTo } from "@/components/contacts/assign-to";
import { listStaff } from "@/lib/staff/server";
import { recordCounts } from "@/lib/contacts/record-counts.ts";
import { workspaceRepo } from "@/lib/workspace/server";
import { TagInput } from "../../leads/tag-input";
import { leadsDeps } from "@/lib/leads/server";
import { saveLeadNotesAction } from "../lead-notes-actions";
import { DuplicateCompare } from "@/components/contacts/duplicate-compare";
import { DUPLICATE_REASON, parseContactKey, type Contact } from "@/lib/contacts/combine.ts";
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
  const contact = data.contacts.find((c) => c.key === key);
  if (!contact) notFound();
  if (contact.refs.clientId) redirect(`/workspace/clients/${contact.refs.clientId}`);

  const lead = data.leads.find((l) => l.id === contact.refs.leadId) ?? null;
  const client = data.clients.find((c) => c.id === contact.refs.clientId) ?? null;
  const customers = data.customers.filter((c) => contact.refs.customerIds.includes(c.id));
  const orders = data.orders.filter((o) => contact.refs.customerIds.includes(o.customer_id));
  const paid = orders.filter((o) => ["paid", "partially_refunded", "refunded"].includes(o.payment_status));
  const value = paid.reduce((sum, o) => sum + o.amount_cents - o.amount_refunded_cents, 0);
  const byKey = new Map(data.contacts.map((c) => [c.key, c]));
  const related = data.duplicates.filter((d) => d.a === key || d.b === key);
  const counts = new Map(await Promise.all([contact, ...related.map((d) => byKey.get(d.a === key ? d.b : d.a)).filter((c): c is Contact => !!c)].map(async (c) => [c.key, await recordCounts(workspaceRepo(), c)] as const)));
  const leadFull = lead ? await leadsDeps().repo.getLead(lead.id).catch(() => null) : null;
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
