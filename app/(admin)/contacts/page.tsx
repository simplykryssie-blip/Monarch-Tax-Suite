import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { formatPhone } from "@/lib/format/ids.ts";
import { EmptyRow, Flash, PageTitle, when } from "@/components/admin/ui";
import { countContacts, DUPLICATE_REASON, filterContacts, type Contact, type ContactFilter } from "@/lib/contacts/combine.ts";
import { loadContacts } from "@/lib/contacts/server";
import { AddContact } from "@/components/contacts/add-contact";
import { staffLabel } from "@/lib/staff/assign.ts";
import { listStaff } from "@/lib/staff/server";
import { AutoSelect } from "@/components/contacts/auto-select";
import { Modal } from "@/components/ui/modal";
import { recordCounts } from "@/lib/contacts/record-counts.ts";
import { workspaceRepo } from "@/lib/workspace/server";
import { DuplicateCompare } from "@/components/contacts/duplicate-compare";
import { undoDismissAction } from "./merge-actions";
import { SelectAll } from "@/components/contacts/select-all";
import { BulkMenu } from "@/components/contacts/bulk-menu";
import { bulkContactsAction } from "./bulk-actions";
import { SETTABLE_STATUSES } from "@/lib/leads/service.ts";
import { LEAD_STATUSES } from "@/lib/leads/types.ts";
import { contactKinds } from "@/lib/contacts/kinds.ts";
import { currentTier } from "@/lib/tier-server";

const KINDS = ["", "lead", "client", "customer", "inactive", "archived"] as const;
const CHIP: Record<string, string> = { lead: "#fff1cc", client: "#e0ecff", customer: "#eee4fb" };

function Chips({ c }: { c: Contact }) {
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {c.chips.map((chip) => (
        <span key={chip.kind} className="monarch-badge" style={{ background: CHIP[chip.kind], opacity: chip.active ? 1 : 0.6 }}>{chip.label}</span>
      ))}
    </span>
  );
}

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; tag?: string; view?: string; notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const kind = ((KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind === "archived" ? "inactive" : sp.kind ?? "") : "") as ContactFilter["kind"];
  const kinds = contactKinds(await currentTier());
  const data = await loadContacts();
  const staff = await listStaff().catch(() => []);
  const counts = countContacts(data.contacts);
  const byKey = new Map(data.contacts.map((c) => [c.key, c]));
  // How much each side holds, for the first pairs only (each count is a few lookups).
  const pairCounts = new Map<string, Awaited<ReturnType<typeof recordCounts>>>();
  await Promise.all(data.duplicates.slice(0, 20).flatMap((d) => [d.a, d.b]).map(async (k) => { const c = byKey.get(k); if (c && !pairCounts.has(k)) pairCounts.set(k, await recordCounts(workspaceRepo(), c)); }));
  const backHref = `/contacts${[sp.q ? `q=${encodeURIComponent(sp.q)}` : "", sp.kind ? `kind=${encodeURIComponent(sp.kind)}` : "", sp.tag ? `tag=${encodeURIComponent(sp.tag)}` : ""].filter(Boolean).length ? `?${[sp.q ? `q=${encodeURIComponent(sp.q)}` : "", sp.kind ? `kind=${encodeURIComponent(sp.kind)}` : "", sp.tag ? `tag=${encodeURIComponent(sp.tag)}` : ""].filter(Boolean).join("&")}` : ""}`;
  const rows = filterContacts(data.contacts, { q: sp.q, kind, tag: sp.tag });
  const allTags = [...new Set(data.contacts.flatMap((c) => c.tags))].sort();
  const tabs: [string, string, number][] = [["", "All", counts.all], ["lead", "Leads", counts.lead], ["client", "Clients", counts.client], ["customer", "Customers", counts.customer], ["inactive", "Archived", counts.inactive]];

  return (
    <>
      <PageTitle title="Contacts">Leads, clients and store customers in one list. A person found in more than one place is one contact.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      <div className="cl-head-actions">
        <AddContact kinds={kinds} />
        <Link className="monarch-secondary" href="/contacts/import">Import</Link>
        {(data.duplicates.length > 0 || data.dismissed.length > 0) && (
          <Modal label={data.duplicates.length ? `Possible duplicates (${data.duplicates.length})` : "Possible duplicates"} title="Possible duplicates" className="monarch-secondary">
            <ul className="cl-list dup-list">
              {data.duplicates.map((d) => {
                const a = byKey.get(d.a);
                const b = byKey.get(d.b);
                if (!a || !b) return null;
                const open = (c: Contact) => (c.refs.clientId ? `/workspace/clients/${c.refs.clientId}` : `/contacts/${c.key}`);
                return (
                  <li key={`${d.a}|${d.b}`}>
                    <DuplicateCompare a={a} b={b} reason={DUPLICATE_REASON[d.reason]} openA={open(a)} openB={open(b)} countsA={pairCounts.get(d.a)} countsB={pairCounts.get(d.b)} />
                  </li>
                );
              })}
            </ul>
            {data.duplicates.length === 0 && <p className="monarch-muted">No possible duplicates right now.</p>}
            {data.dismissed.length > 0 && (
              <details className="dup-undo">
                <summary>Marked as not a duplicate ({data.dismissed.length})</summary>
                <ul className="cl-list">
                  {data.dismissed.map((d) => {
                    const a = byKey.get(d.a), b = byKey.get(d.b);
                    if (!a || !b) return null;
                    return (
                      <li key={`${d.a}|${d.b}`}>
                        <form action={undoDismissAction} className="monarch-inline-form">
                          <input type="hidden" name="a" value={d.a} /><input type="hidden" name="b" value={d.b} />
                          <span>{a.name} and {b.name}</span>
                          <button className="monarch-secondary">Put back</button>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
          </Modal>
        )}
      </div>
      {data.notes.map((n) => <div key={n} className="monarch-notice" role="status">{n}</div>)}
      <>
          <form method="get" action="/contacts" role="search" className="ct-search">
            <label htmlFor="q" style={{ position: "absolute", left: -9999 }}>Search contacts</label>
            <input id="q" name="q" type="search" defaultValue={sp.q ?? ""} placeholder="Search by name, email, phone or tag" />
            <AutoSelect name="kind" label="Show" defaultValue={kind ?? ""} options={tabs.map(([k, name, n]) => ({ value: k, label: `${name} (${n})` }))} />
            <AutoSelect name="tag" label="Tag" defaultValue={sp.tag ?? ""} options={[{ value: "", label: "Any tag" }, ...allTags.map((t) => ({ value: t, label: t }))]} />
            <button type="submit" className="monarch-primary">Search</button>
          </form>
          <form action={bulkContactsAction}>
            <input type="hidden" name="back" value={backHref} />
            <section className="monarch-panel">
              <div className="monarch-panel-head"><h2>{rows.length} {rows.length === 1 ? "contact" : "contacts"}</h2></div>
              {rows.length > 0 && <BulkMenu staff={staff.map((m) => ({ id: m.id, label: m.label }))} tags={allTags} statuses={SETTABLE_STATUSES.map((st) => ({ value: st, label: LEAD_STATUSES[st] }))} />}
              <div className="monarch-table-wrap">
                <table>
                  <thead><tr><th><SelectAll /></th><th>NAME</th><th>STATUS</th><th>PHONE</th><th>ASSIGNED</th><th>TAGS</th><th>LAST ACTIVITY</th></tr></thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <EmptyRow colSpan={7}>No contacts match.</EmptyRow>
                    ) : (
                      rows.map((c) => (
                        <tr key={c.key}>
                          <td><input type="checkbox" name="key" value={c.key} aria-label={`Select ${c.name}`} /></td>
                          <td><Link href={c.refs.clientId ? `/workspace/clients/${c.refs.clientId}` : `/contacts/${c.key}`}><b>{c.name}</b></Link><small className="monarch-subcell">{c.email ?? "no email"}</small></td>
                          <td><Chips c={c} /></td>
                          <td>{c.phone ? formatPhone(c.phone) : "—"}</td>
                          <td>{staffLabel(staff, c.assignedTo) ?? "—"}</td>
                          <td>{c.tags.join(", ") || "—"}</td>
                          <td>{when(c.lastActivity)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </form>
      </>
    </>
  );
}
