import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { Icon } from "@/components/admin/icons";
import { maskEfin, tracksTeam } from "@/lib/efin/rules.ts";
import { loadSnapshot } from "@/lib/efin/service";
import { EFIN_STATUSES } from "@/lib/efin/types.ts";
import { BulkBar, SelectAll } from "../bulk";
import { personName, Verified } from "../parts";

type Params = { q?: string; status?: string; org?: string; review?: string; rel?: string; archived?: string; notice?: string; error?: string };

const REL_LABEL: Record<string, string> = { internal: "My office", partner: "Partner", client: "Client", other: "Other" };

export default async function EfinRegistry({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  const sp = await searchParams;
  const result = await load(loadSnapshot);
  return (
    <>
      <PageTitle title="EROs & EFINs">Your EROs and their EFINs in one list, like contacts. Open one to edit it, see its locations and renewals, and, for your own office and partners, its team. Dates and verification are what you recorded here, not a live IRS status.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? (
        <SetupRequired message={result.message} module="efin" />
      ) : (
        (() => {
          const s = result.data;
          const showArchived = sp.archived === "1";
          const q = (sp.q ?? "").trim().toLowerCase();
          const orgOf = (id: string) => s.orgs.find((o) => o.id === id);
          // One row per EFIN, plus one row for each ERO that has no EFIN yet (so it can still be opened, edited or deleted).
          type Row = { key: string; value: string; efin?: (typeof s.efins)[number]; org: (typeof s.orgs)[number] };
          const rows: Row[] = [];
          for (const e of s.efins) {
            const o = orgOf(e.organization_id);
            if (o && !!e.archived_at === showArchived) rows.push({ key: e.id, value: `efin:${e.id}`, efin: e, org: o });
          }
          for (const o of s.orgs) {
            if (!!o.archived_at !== showArchived) continue;
            if (!s.efins.some((e) => e.organization_id === o.id && !!e.archived_at === showArchived)) rows.push({ key: o.id, value: `org:${o.id}`, org: o });
          }
          const shown = rows.filter((r) =>
            (!sp.status || r.efin?.internal_status === sp.status) &&
            (!sp.org || r.org.id === sp.org) &&
            (!sp.rel || r.org.relationship === sp.rel) &&
            (!sp.review || (r.efin && s.assignments.some((a) => a.efin_id === r.efin!.id && a.state === "pending_review"))) &&
            (!q || `${r.efin?.efin_last4 ?? ""} ${r.org.legal_name} ${r.org.dba_name ?? ""} ${personName(s.people, r.efin?.ero_person_id ?? r.org.administrator_person_id)}`.toLowerCase().includes(q)),
          );
          const archivedCount = s.efins.filter((e) => e.archived_at).length + s.orgs.filter((o) => o.archived_at).length;
          return (
            <div className="efin-flow"><section className="monarch-panel">
              <div className="monarch-panel-head">
                <div><h2>{sp.review ? "Assignments waiting for review" : showArchived ? "Archived" : "All EROs"}</h2><p>EFINs are shown masked. Open one to reveal the full number (the reveal is logged).</p></div>
                <Link className="monarch-primary" href="/efin/new"><Icon name="plus" size={16} /> Add an ERO</Link>
              </div>
              <form className="efin-filter" method="get" action="/efin/list">
                <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, business or last 4" aria-label="Search EFINs" />
                <select name="status" defaultValue={sp.status ?? ""} aria-label="Status"><option value="">All statuses</option>{EFIN_STATUSES.map((v) => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}</select>
                <select name="rel" defaultValue={sp.rel ?? ""} aria-label="Relationship"><option value="">All relationships</option>{Object.entries(REL_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <select name="org" defaultValue={sp.org ?? ""} aria-label="Business"><option value="">All businesses</option>{s.orgs.map((o) => <option key={o.id} value={o.id}>{o.legal_name}</option>)}</select>
                <select name="archived" defaultValue={sp.archived ?? ""} aria-label="Archived"><option value="">Current</option><option value="1">Archived ({archivedCount})</option></select>
                <button className="monarch-secondary efin-small" type="submit">Filter</button>
              </form>
              <div className="monarch-table-wrap">
                <table>
                  <thead><tr><th style={{ width: 36 }}><SelectAll /></th><th>ERO / BUSINESS</th><th>LOCATIONS</th><th>EFIN</th><th>STATUS</th><th>ASSIGNMENT</th><th>VERIFICATION</th><th>RENEWAL</th></tr></thead>
                  <tbody>
                    {shown.length === 0 ? (
                      <EmptyRow colSpan={8}>{rows.length === 0 && !showArchived ? "No EROs yet. Add your first ERO to start tracking its EFIN, locations and renewals." : "Nothing matches those filters."}</EmptyRow>
                    ) : shown.map((r) => {
                      const e = r.efin;
                      const ls = s.locations.filter((l) => l.organization_id === r.org.id && !l.archived_at);
                      const a = e && tracksTeam(r.org.relationship) ? s.assignments.find((x) => x.efin_id === e.id && x.role === "ero" && !["revoked", "expired"].includes(x.state)) : undefined;
                      return (
                        <tr key={r.key}>
                          <td><input type="checkbox" name="ids" value={r.value} aria-label={`Select ${r.org.legal_name}`} /></td>
                          <td>
                            <Link href={e ? `/efin/${e.id}` : `/efin/org/${r.org.id}`}><b>{r.org.legal_name}</b></Link><span className="efin-tag">{REL_LABEL[r.org.relationship] ?? r.org.relationship}</span>
                            <div className="monarch-muted">{personName(s.people, e?.ero_person_id ?? r.org.administrator_person_id)}</div>
                          </td>
                          <td>{ls.length === 0 ? "—" : ls.length === 1 ? ls[0].name : `${ls.length} locations`}</td>
                          <td className="efin-mask">{e ? maskEfin(e.efin_last4) : <span className="monarch-muted">No EFIN yet</span>}</td>
                          <td>{e ? <Badge value={e.internal_status === "pending_verification" ? "pending" : e.internal_status} /> : "—"}</td>
                          <td>{e && tracksTeam(r.org.relationship) ? (a ? <Badge value={a.state} /> : <span className="monarch-muted">None</span>) : <span className="monarch-muted">—</span>}</td>
                          <td>{e ? <Verified value={e.external_status} /> : "—"}</td>
                          <td>{e?.recorded_expiration ? <>{e.recorded_expiration}{!e.expiration_verified && <small className="monarch-muted"> (unverified)</small>}</> : <span className="monarch-muted">{e ? "Not recorded" : "—"}</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {shown.length > 0 && <BulkBar />}
            </section></div>
          );
        })()
      )}
    </>
  );
}
