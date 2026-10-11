import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { Flash, load, SetupRequired } from "@/components/admin/ui";
import { Icon } from "@/components/admin/icons";
import { displayAddress } from "@/lib/efin/format.ts";
import { loadSnapshot } from "@/lib/efin/service";
import { saveLocationAction, updateLocationAction } from "../../actions";
import { ActionForm } from "../../action-form";
import { FormattedInput } from "../../formatted-input";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every location of one ERO. Opened from the firm page's Locations row, so there is no Locations tab. */
export default async function Locations({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ from?: string; add?: string; notice?: string; error?: string }> }) {
  await requireAdmin();
  const { orgId } = await params;
  const sp = await searchParams;
  const result = await load(loadSnapshot);
  if (!result.ok) return <SetupRequired message={result.message} module="efin" />;
  const s = result.data;
  const org = s.orgs.find((o) => o.id === orgId);
  if (!org) notFound();
  const efinId = sp.from && UUID.test(sp.from) && s.efins.some((e) => e.id === sp.from && e.organization_id === orgId) ? sp.from : s.efins.find((e) => e.organization_id === orgId && !e.archived_at)?.id;
  const firmHref = efinId ? `/efin/${efinId}` : `/efin/org/${orgId}`;
  const here = `/efin/locations/${orgId}${efinId ? `?from=${efinId}` : ""}`;
  const locations = s.locations.filter((l) => l.organization_id === orgId && !l.archived_at);
  return (
    <>
      <nav className="efin-crumbs" aria-label="Breadcrumb">
        <Link href="/efin" aria-label="EFIN Management"><Icon name="home" size={16} /></Link>
        <Link href="/efin">EFIN Management</Link><span>›</span>
        <Link href="/efin/list">Firms</Link><span>›</span>
        <Link href={firmHref}>{org.legal_name}</Link><span>›</span>
        <b>Locations</b>
      </nav>
      <div className="efin-loc-head">
        <div>
          <h1 className="efin-edit-title">Locations</h1>
          <p className="monarch-muted" style={{ margin: 0 }}>{org.legal_name} · {locations.length} location{locations.length === 1 ? "" : "s"}</p>
        </div>
        <Link className="monarch-primary" href={`${here}${here.includes("?") ? "&" : "?"}add=1#add`}><Icon name="plus" size={16} /> Add location</Link>
      </div>
      <Flash notice={sp.notice} error={sp.error} />

      <div className="efin-flow">
        <details className="efin-edit" id="add" open={sp.add === "1"}>
          <summary>Add a location</summary>
          <div className="efin-edit-body">
            <ActionForm action={saveLocationAction} className="monarch-form">
              <input type="hidden" name="organization_id" value={orgId} /><input type="hidden" name="back" value={here} />
              <label>Location name<input name="name" required maxLength={200} placeholder="North branch" /></label>
              <label>Street address<input name="line1" maxLength={200} /></label>
              <label>City<input name="city" maxLength={100} /></label>
              <label>State<FormattedInput kind="state" name="state" /></label>
              <label>ZIP<FormattedInput kind="zip" name="zip" /></label>
              <label className="monarch-check"><input type="checkbox" name="is_primary" /> Make this the primary location</label>
              <div className="is-wide"><button className="monarch-primary" type="submit">Save location</button></div>
            </ActionForm>
          </div>
        </details>

        {locations.length === 0 ? (
          <p className="monarch-muted" style={{ padding: "22px 0" }}>No locations yet. Use Add location to record the first one.</p>
        ) : locations.map((l) => (
          <details className="efin-edit" key={l.id}>
            <summary>
              <span className="efin-loc-sum"><b>{l.name}</b>{l.is_primary && <span className="efin-tag">Primary</span>}<small>{displayAddress(l.address) || "No address recorded"}</small></span>
            </summary>
            <div className="efin-edit-body">
              <ActionForm action={updateLocationAction} className="monarch-form">
                <input type="hidden" name="location_id" value={l.id} /><input type="hidden" name="back" value={here} />
                <label>Location name<input name="name" required maxLength={200} defaultValue={l.name} /></label>
                <label>Street address<input name="line1" maxLength={200} defaultValue={l.address.line1 ?? ""} /></label>
                <label>City<input name="city" maxLength={100} defaultValue={l.address.city ?? ""} /></label>
                <label>State<FormattedInput kind="state" name="state" defaultValue={l.address.state ?? ""} /></label>
                <label>ZIP<FormattedInput kind="zip" name="zip" defaultValue={l.address.zip ?? ""} /></label>
                <label className="monarch-check"><input type="checkbox" name="is_primary" defaultChecked={l.is_primary} /> Primary location</label>
                <label className="monarch-check"><input type="checkbox" name="remove" /> Remove this location (kept in the history)</label>
                <div className="is-wide"><button className="monarch-secondary" type="submit">Save changes</button></div>
              </ActionForm>
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
