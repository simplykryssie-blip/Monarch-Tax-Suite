import type { Metadata } from "next";
import { after } from "next/server";
import { ConnectionActions, LeadSettingsForm, RetryButton, SignInForm } from "@/components/portal/portal-forms";
import { portalSignOutAction } from "./actions";
import { crmConfigStatus, crmDeps, portalLicense } from "@/lib/crm/server";
import { LEAD_STATUS_LABELS, processDueLeads, readLeadDetails } from "@/lib/crm/leads.ts";
import { DEFAULT_LEAD_SETTINGS } from "@/lib/crm/types.ts";
import { PLATFORM_GUIDES } from "@/lib/commerce/platforms.ts";

export const metadata: Metadata = { title: "Customer portal | Monarch Tax Suite", robots: { index: false, follow: false } };

const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" }).format(new Date(iso)) : "—");

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="monarch-public">
      <div className="monarch-public-card portal-card">
        <div className="monarch-eyebrow">MONARCH TAX SUITE · CUSTOMER PORTAL</div>
        {children}
      </div>
    </main>
  );
}

export default async function PortalPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { notice, error } = await searchParams;
  const config = crmConfigStatus();
  const flash = error ? <p className="monarch-alert is-error" role="alert">{error}</p> : notice ? <p className="monarch-alert" role="status">{notice}</p> : null;

  if (!config.encryption) {
    return <Shell><h1>Customer portal</h1><p>The customer portal is being set up and is not available yet. Please contact info@monarchtaxsuite.com.</p></Shell>;
  }
  const license = await portalLicense();
  if (!license) {
    return (
      <Shell>
        <h1>Calculator settings</h1>
        <p>Sign in with the license key you received with your Monarch Basic Tax Calculator to manage your GoHighLevel lead integration.</p>
        {flash}
        <SignInForm />
      </Shell>
    );
  }

  const deps = crmDeps();
  const [connection, savedSettings, counts, leads, domains] = await Promise.all([
    deps.repo.getLiveConnection(license.id),
    deps.repo.getLeadSettings(license.id),
    deps.repo.leadCounts(license.id),
    deps.repo.listLeads(license.id, 50),
    deps.commerce.listDomains(license.id),
  ]);
  const settings = savedSettings ?? DEFAULT_LEAD_SETTINGS(license.id);
  // Opportunistically deliver anything due for this buyer.
  if (connection?.status === "connected") after(() => processDueLeads(deps, { licenseId: license.id, limit: 10 }));

  const status = !connection ? "Not connected" : connection.status === "connected" ? "Connected" : "Reauthorization required";
  const pending = counts.received + counts.sending + counts.retry_pending + counts.reauth_required;

  return (
    <Shell>
      <div className="portal-head">
        <h1>Calculator settings</h1>
        <form action={portalSignOutAction}><button className="monarch-secondary">Sign out</button></form>
      </div>
      {flash}
      <p>
        License <code>{license.key_prefix}…</code> · {license.status === "active" ? "Active" : license.status} · Tax year {license.licensed_tax_year ?? "—"} · Authorized
        websites: {domains.filter((d) => d.status === "active").map((d) => d.domain).join(", ") || "none yet"}
      </p>

      <section className="portal-section">
        <h2>GoHighLevel</h2>
        {!config.highlevel ? (
          <p className="monarch-notice"><b>NOT AVAILABLE YET</b> Monarch has not finished setting up the GoHighLevel app, so connecting is not possible yet.</p>
        ) : (
          <>
            <dl className="monarch-dl">
              <dt>Status</dt><dd><span className={`monarch-badge ${connection?.status === "connected" ? "active" : connection ? "pending" : ""}`}>{status}</span></dd>
              {connection && (
                <>
                  <dt>Location</dt><dd>{connection.location_name ?? "—"} <small className="monarch-subcell">ID {connection.location_id}</small></dd>
                  <dt>Connected</dt><dd>{fmt(connection.connected_at)}</dd>
                  <dt>Health</dt><dd>{connection.last_error ? <span className="portal-error">{connection.last_error}</span> : connection.last_checked_at ? `OK · last checked ${fmt(connection.last_checked_at)}` : "Not tested yet"}</dd>
                  <dt>Last successful sync</dt><dd>{fmt(connection.last_success_at)}</dd>
                </>
              )}
              <dt>Leads</dt><dd>{counts.sent} sent · {counts.failed} failed · {pending} pending</dd>
            </dl>
            {!connection && (
              <div className="portal-steps">
                <p><b>Send calculator leads to your own GoHighLevel sub-account.</b></p>
                <ol>
                  <li>Select <b>Connect GoHighLevel</b>. You sign in on GoHighLevel&apos;s own page; Monarch never sees your password.</li>
                  <li>Choose the sub-account (location) whose Contacts should receive leads, and approve access.</li>
                  <li>Back here, select <b>Test connection</b>, then turn on lead capture below.</li>
                </ol>
              </div>
            )}
            <div className="monarch-inline-actions">
              {license.status === "active" && (
                <a className="monarch-primary" href="/api/integrations/crm/connect">
                  {!connection ? "Connect GoHighLevel" : connection.status === "connected" ? "Change location / reconnect" : "Reconnect GoHighLevel"}
                </a>
              )}
            </div>
            <ConnectionActions canTest={connection?.status === "connected"} canDisconnect={Boolean(connection)} />
          </>
        )}
      </section>

      <section className="portal-section">
        <h2>Lead capture</h2>
        <p className="monarch-muted">
          When on, your calculator shows a short, optional contact form under the estimate (first name, last name, email, phone, and a consent checkbox naming your business). It is a lead
          form, not a tax return intake: it never asks for Social Security numbers or tax documents.
        </p>
        <LeadSettingsForm settings={settings} connected={connection?.status === "connected"} />
      </section>

      <section className="portal-section">
        <div className="portal-head"><h2>Lead delivery history</h2>{connection?.status === "connected" && <RetryButton />}</div>
        <p className="monarch-muted">
          Contact details are kept encrypted only until delivered to GoHighLevel. Undelivered leads stay visible here for 30 days so you can follow up, then their details are removed.
        </p>
        <div className="monarch-table-wrap">
          <table>
            <thead><tr><th>RECEIVED</th><th>STATUS</th><th>CONTACT</th><th>WEBSITE</th><th>ATTEMPTS</th><th>DETAILS</th></tr></thead>
            <tbody>
              {leads.length === 0 ? (
                <tr><td colSpan={6} className="monarch-empty">No leads yet.</td></tr>
              ) : (
                leads.map((lead) => {
                  const details = lead.status !== "sent" ? readLeadDetails(deps, lead) : null;
                  return (
                    <tr key={lead.id}>
                      <td>{fmt(lead.created_at)}</td>
                      <td><span className={`monarch-badge ${lead.status === "sent" ? "active" : lead.status === "failed" ? "refunded" : "pending"}`}>{LEAD_STATUS_LABELS[lead.status]}</span>{lead.last_error && <small className="monarch-subcell portal-error">{lead.last_error}</small>}</td>
                      <td>{lead.email_masked ?? "—"}{lead.ghl_contact_id && <small className="monarch-subcell">Contact {lead.ghl_contact_id}{lead.contact_created === false ? " (existing)" : ""}</small>}</td>
                      <td>{lead.embed_host ?? "—"}</td>
                      <td>{lead.attempts}</td>
                      <td>
                        {details ? (
                          <details><summary>Show</summary>{details.firstName} {details.lastName ?? ""}<br />{details.email ?? ""}<br />{details.phone ?? ""}</details>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="portal-section">
        <h2>Works on any supported platform</h2>
        <p className="monarch-muted">
          Lead delivery runs on Monarch&apos;s servers, so it works the same wherever your calculator is installed ({Object.values(PLATFORM_GUIDES).map((g) => g.label).join(", ")}). The
          form appears only on your authorized websites.
        </p>
      </section>
    </Shell>
  );
}
