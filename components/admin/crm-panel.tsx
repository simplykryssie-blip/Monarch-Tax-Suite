import { adminDisconnectCrmAction } from "@/app/(admin)/actions";
import { crmConfigStatus, crmDeps } from "@/lib/crm/server";
import { LEAD_STATUS_LABELS } from "@/lib/crm/leads.ts";
import { EmptyRow, when } from "./ui";

/** Administrator view of a buyer's GoHighLevel connection and lead deliveries. Never shows tokens or lead contact details. */
export async function CrmPanel({ licenseId }: { licenseId: string }) {
  const config = crmConfigStatus();
  let data;
  try {
    const deps = crmDeps();
    const [connection, settings, counts, leads] = await Promise.all([
      deps.repo.getLiveConnection(licenseId),
      deps.repo.getLeadSettings(licenseId),
      deps.repo.leadCounts(licenseId),
      deps.repo.listLeads(licenseId, 20),
    ]);
    data = { connection, settings, counts, leads };
  } catch {
    return <section className="monarch-panel monarch-pad"><h2 className="monarch-h2">GoHighLevel lead delivery</h2><p className="monarch-muted">Lead integration tables are not available yet.</p></section>;
  }
  const { connection, settings, counts, leads } = data;
  return (
    <section className="monarch-panel">
      <div className="monarch-panel-head">
        <div>
          <h2>GoHighLevel lead delivery</h2>
          <p>
            Buyer-managed in the customer portal (/portal). App credentials {config.highlevel ? "configured" : "NOT configured"} · encryption key {config.encryption ? "configured" : "NOT configured"}.
          </p>
        </div>
        {connection && (
          <form action={adminDisconnectCrmAction}>
            <input type="hidden" name="license_id" value={licenseId} />
            <button className="monarch-secondary is-danger" type="submit">Disconnect</button>
          </form>
        )}
      </div>
      <div className="monarch-pad">
        <dl className="monarch-dl">
          <dt>Connection</dt><dd>{!connection ? "Not connected" : connection.status === "connected" ? "Connected" : "Reauthorization required"}</dd>
          {connection && (<><dt>Location</dt><dd>{connection.location_name ?? "—"} <small className="monarch-subcell">ID {connection.location_id}</small></dd>
          <dt>Last successful sync</dt><dd>{when(connection.last_success_at)}</dd>
          <dt>Last error</dt><dd>{connection.last_error ?? "—"}</dd></>)}
          <dt>Lead capture</dt><dd>{settings?.enabled ? `On · ${settings.business_name}` : "Off"}</dd>
          <dt>Deliveries</dt><dd>{counts.sent} sent · {counts.failed} failed · {counts.received + counts.sending + counts.retry_pending + counts.reauth_required} pending</dd>
        </dl>
      </div>
      <div className="monarch-table-wrap">
        <table>
          <thead><tr><th>RECEIVED</th><th>STATUS</th><th>CONTACT</th><th>WEBSITE</th><th>ATTEMPTS</th><th>LAST ERROR</th></tr></thead>
          <tbody>
            {leads.length === 0 ? <EmptyRow colSpan={6}>No leads.</EmptyRow> : leads.map((l) => (
              <tr key={l.id}><td>{when(l.created_at)}</td><td>{LEAD_STATUS_LABELS[l.status]}</td><td>{l.email_masked ?? "—"}</td><td>{l.embed_host ?? "—"}</td><td>{l.attempts}</td><td>{l.last_error ?? "—"}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
