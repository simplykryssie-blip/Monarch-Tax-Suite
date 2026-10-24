import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { EmptyRow, PageTitle, when } from "@/components/admin/ui";
import { countContacts, DUPLICATE_REASON, filterContacts, type Contact, type ContactFilter } from "@/lib/contacts/combine.ts";
import { loadContacts } from "@/lib/contacts/server";
import { AddContact } from "@/components/contacts/add-contact";
import { contactKinds } from "@/lib/contacts/kinds.ts";
import { currentTier } from "@/lib/tier-server";

const KINDS = ["", "lead", "client", "customer", "inactive"] as const;
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

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; view?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const kind = (KINDS as readonly string[]).includes(sp.kind ?? "") ? ((sp.kind ?? "") as ContactFilter["kind"]) : "";
  const kinds = contactKinds(await currentTier());
  const data = await loadContacts();
  const counts = countContacts(data.contacts);
  const rows = filterContacts(data.contacts, { q: sp.q, kind });
  const byKey = new Map(data.contacts.map((c) => [c.key, c]));
  const review = sp.view === "duplicates";
  const href = (k: string) => {
    const p = new URLSearchParams();
    if (k) p.set("kind", k);
    if (sp.q) p.set("q", sp.q);
    const s = p.toString();
    return s ? `/contacts?${s}` : "/contacts";
  };
  const tabs: [string, string, number][] = [["", "All", counts.all], ["lead", "Leads", counts.lead], ["client", "Clients", counts.client], ["customer", "Customers", counts.customer], ["inactive", "Inactive", counts.inactive]];

  return (
    <>
      <PageTitle title="Contacts">Leads, clients and store customers in one list. A person found in more than one place is one contact.</PageTitle>
      <div className="cl-head-actions"><AddContact kinds={kinds} /></div>
      {data.notes.map((n) => <div key={n} className="monarch-notice" role="status">{n}</div>)}
      <nav className="mf-tabs" aria-label="Contacts view" style={{ marginBottom: 12 }}>
        <Link href="/contacts" className={!review ? "is-active" : undefined} aria-current={!review ? "page" : undefined}>Contacts</Link>
        <Link href="/contacts?view=duplicates" className={review ? "is-active" : undefined} aria-current={review ? "page" : undefined}>Possible duplicates ({data.duplicates.length})</Link>
      </nav>

      {review ? (
        <section className="monarch-panel">
          <div className="monarch-panel-head"><h2>Possible duplicates</h2><span>{data.duplicates.length} to review</span></div>
          <p style={{ padding: "0 20px", color: "#77746b", fontSize: 12 }}>These may be the same person. Nothing is combined automatically. Open each one to look at the records side by side.</p>
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>CONTACT</th><th>CONTACT</th><th>WHY</th></tr></thead>
              <tbody>
                {data.duplicates.length === 0 ? (
                  <EmptyRow colSpan={3}>No possible duplicates.</EmptyRow>
                ) : (
                  data.duplicates.map((d) => {
                    const a = byKey.get(d.a);
                    const b = byKey.get(d.b);
                    if (!a || !b) return null;
                    return (
                      <tr key={`${d.a}|${d.b}`}>
                        <td><Link href={`/contacts/${a.key}`}><b>{a.name}</b></Link><small className="monarch-subcell">{a.email ?? "no email"}</small></td>
                        <td><Link href={`/contacts/${b.key}`}><b>{b.name}</b></Link><small className="monarch-subcell">{b.email ?? "no email"}</small></td>
                        <td>{DUPLICATE_REASON[d.reason]}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <>
          <form method="get" action="/contacts" role="search" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {kind && <input type="hidden" name="kind" value={kind} />}
            <label htmlFor="q" style={{ position: "absolute", left: -9999 }}>Search contacts</label>
            <input id="q" name="q" type="search" defaultValue={sp.q ?? ""} placeholder="Search by name, email, phone or tag" style={{ flex: "1 1 280px", minHeight: 44, padding: "0 14px", border: "1px solid #dcd9d0", borderRadius: 4 }} />
            <button type="submit" className="monarch-primary" style={{ minHeight: 44 }}>Search</button>
          </form>
          <nav className="mf-tabs" aria-label="Show" style={{ marginBottom: 4 }}>
            {tabs.map(([k, name, n]) => (
              <Link key={k || "all"} href={href(k)} className={kind === k ? "is-active" : undefined} aria-current={kind === k ? "page" : undefined}>{name} ({n})</Link>
            ))}
          </nav>
          <p style={{ margin: "0 0 12px", color: "#77746b", fontSize: 12 }}>One person can be more than one thing, so the counts can add up to more than the total.</p>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><h2>{rows.length} {rows.length === 1 ? "contact" : "contacts"}</h2></div>
            <div className="monarch-table-wrap">
              <table>
                <thead><tr><th>NAME</th><th>IS A</th><th>PHONE</th><th>TAGS</th><th>LAST ACTIVITY</th></tr></thead>
                <tbody>
                  {rows.length === 0 ? (
                    <EmptyRow colSpan={5}>No contacts match.</EmptyRow>
                  ) : (
                    rows.map((c) => (
                      <tr key={c.key}>
                        <td><Link href={c.refs.clientId ? `/workspace/clients/${c.refs.clientId}` : `/contacts/${c.key}`}><b>{c.name}</b></Link><small className="monarch-subcell">{c.email ?? "no email"}</small></td>
                        <td><Chips c={c} /></td>
                        <td>{c.phone ?? "—"}</td>
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
      )}
    </>
  );
}
