import { adminDisconnectCrmAction } from "@/app/(admin)/actions";
import { crmConfigStatus, crmDeps } from "@/lib/crm/server";
import { EmptyRow, when } from "./ui";

/** Administrator view of a buyer's lead destination and delivery diagnostics. Shows no tokens and no lead data (Monarch stores none). */
export async function CrmPanel({ licenseId }: { licenseId: string }) {
  const config = crmConfigStatus();
  let data;
  try {
    const deps = crmDeps();
    const [connection, settings, log] = await Promise.all([deps.repo.getLiveConnection(licenseId), deps.repo.getLeadSettings(licenseId), deps.repo.listDeliveries(licenseId, 20)]);
    data = { connection, settings, log };
  } catch {
    return <section className="monarch-panel monarch-pad"><h2 className="monarch-h2">Lead destination</h2><p className="monarch-muted">Lead destination tables are not available yet.</p></section>;
  }
  const { connection, settings, log } = data;
  return (
    <section className="monarch-panel">
      <div className="monarch-panel-head">
        <div>
          <h2>Lead destination (buyer-owned)</h2>
          <p>Configured by the buyer at /integrations with their license key. Encryption key {config.encryption ? "configured" : "NOT configured"} · GoHighLevel app {config.highlevel ? "configured" : "not configured"}.</p>
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
          <dt>Destination</dt><dd>{!connection ? "Not connected" : connection.provider === "webhook" ? `Webhook · ${connection.webhook_host}` : `GoHighLevel · ${connection.location_name ?? connection.location_id}`}{connection?.status === "reauth_required" ? " (reauthorization required)" : ""}</dd>
          {connection && (<><dt>Last delivery</dt><dd>{when(connection.last_success_at)}</dd><dt>Last error</dt><dd>{connection.last_error ?? "—"}</dd></>)}
          <dt>Lead form</dt><dd>{settings?.enabled ? `On · ${settings.business_name}` : "Off"}</dd>
        </dl>
      </div>
      <div className="monarch-table-wrap">
        <table>
          <thead><tr><th>WHEN</th><th>OUTCOME</th><th>DESTINATION</th><th>REASON</th><th>HTTP</th><th>MS</th></tr></thead>
          <tbody>
            {log.length === 0 ? <EmptyRow colSpan={6}>No deliveries in the last 30 days.</EmptyRow> : log.map((l) => (
              <tr key={l.id}><td>{when(l.created_at)}</td><td>{l.outcome}</td><td>{l.provider ?? "—"}</td><td>{l.reason ?? "—"}</td><td>{l.http_status ?? "—"}</td><td>{l.duration_ms ?? "—"}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
