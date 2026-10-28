import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
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
  // How much each side holds, for the first pairs only (each count is a few lookups).
  const pairCounts = new Map<string, Awaited<ReturnType<typeof recordCounts>>>();
  await Promise.all(data.duplicates.slice(0, 20).flatMap((d) => [d.a, d.b]).map(async (k) => { const c = byKey.get(k); if (c && !pairCounts.has(k)) pairCounts.set(k, await recordCounts(workspaceRepo(), c)); }));
  const rows = filterContacts(data.contacts, { q: sp.q, kind, tag: sp.tag });
  const byKey = new Map(data.contacts.map((c) => [c.key, c]));
  const allTags = [...new Set(data.contacts.flatMap((c) => c.tags))].sort();
  const tabs: [string, string, number][] = [["", "All", counts.all], ["lead", "Leads", counts.lead], ["client", "Clients", counts.client], ["customer", "Customers", counts.customer], ["inactive", "Archived", counts.inactive]];

  return (
    <>
      <PageTitle title="Contacts">Leads, clients and store customers in one list. A person found in more than one place is one contact.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      <div className="cl-head-actions">
        <AddContact kinds={kinds} />
        <Link className="monarch-secondary" href="/contacts/import">Import</Link>
        {data.duplicates.length > 0 && (
          <Modal label={`Possible duplicates (${data.duplicates.length})`} title="Possible duplicates" className="monarch-secondary">
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
          <section className="monarch-panel">
            <div className="monarch-panel-head"><h2>{rows.length} {rows.length === 1 ? "contact" : "contacts"}</h2></div>
            <div className="monarch-table-wrap">
              <table>
                <thead><tr><th>NAME</th><th>IS A</th><th>PHONE</th><th>ASSIGNED</th><th>TAGS</th><th>LAST ACTIVITY</th></tr></thead>
                <tbody>
                  {rows.length === 0 ? (
                    <EmptyRow colSpan={6}>No contacts match.</EmptyRow>
                  ) : (
                    rows.map((c) => (
                      <tr key={c.key}>
                        <td><Link href={c.refs.clientId ? `/workspace/clients/${c.refs.clientId}` : `/contacts/${c.key}`}><b>{c.name}</b></Link><small className="monarch-subcell">{c.email ?? "no email"}</small></td>
                        <td><Chips c={c} /></td>
                        <td>{c.phone ?? "—"}</td>
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
      </>
    </>
  );
}
