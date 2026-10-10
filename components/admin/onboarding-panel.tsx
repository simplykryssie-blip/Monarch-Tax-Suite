import { resendSetupEmailAction } from "@/app/(admin)/actions";
import { automationDeps } from "@/lib/automation/server";
import { crmDeps } from "@/lib/crm/server";
import { commerceRepo } from "@/lib/admin";
import { deriveProgress, inviteFacts, STATUS_LABELS } from "@/lib/automation/progress.ts";
import { Badge, when } from "./ui";

const currentTime = () => Date.now();

/** Where a customer is in self-service setup, whether the setup email arrived, and what needs attention. */
export async function OnboardingPanel({ licenseId }: { licenseId: string }) {
  let data;
  try {
    const auto = automationDeps();
    const crm = crmDeps();
    const [license, domains, connection, profile, events, links] = await Promise.all([
      commerceRepo().getLicense(licenseId), commerceRepo().listDomains(licenseId), crm.repo.getLiveConnection(licenseId),
      auto.repo.getProfile(licenseId), auto.repo.listEventsByLicense(licenseId, 40), auto.repo.listLinksForLicense(licenseId, 10),
    ]);
    const executions = await auto.repo.listExecutionsForEvents(events.map((e) => e.id));
    const installation = license ? await commerceRepo().findInstallationByOrder(license.order_id) : null;
    const invite = inviteFacts(events, executions, links, currentTime());
    const conn = connection ? { provider: connection.provider, status: connection.status, last_checked_at: connection.last_checked_at, last_error: connection.last_error } : null;
    data = { license: license!, domains, conn, profile, invite, installation, progress: deriveProgress({ license: license!, profile, domains, connection: conn, invite }) };
  } catch {
    return <section className="monarch-panel monarch-pad"><h2 className="monarch-h2">Customer onboarding</h2><p className="monarch-muted">The onboarding tables are not available yet. Apply the Automation Center and onboarding migrations.</p></section>;
  }
  const { license, domains, conn, profile, invite, installation, progress } = data;
  const active = domains.filter((d) => d.status === "active");
  const inviteText = { none: "No setup email has been requested", sent: "Sent", sending: "Sending or waiting to retry", failed: "Failed" }[invite.status];
  return (
    <section className="monarch-panel">
      <div className="monarch-panel-head">
        <div><h2>Customer onboarding</h2><p>The customer completes setup themselves from the emailed link.</p></div>
        {license.status !== "revoked" && (
          <form action={resendSetupEmailAction}><input type="hidden" name="id" value={license.id} /><button className="monarch-secondary">{invite.status === "none" ? "Send setup email" : "Resend setup email"}</button></form>
        )}
      </div>
      <div className="monarch-pad">
        <dl className="monarch-dl">
          <dt>Status</dt><dd><Badge value={progress.status} /> {STATUS_LABELS[progress.status]}{profile?.completed_at ? ` · ${when(profile.completed_at)}` : ""}</dd>
          <dt>Setup email</dt><dd>{inviteText}{invite.at ? ` · ${when(invite.at)}` : ""}{invite.messageId ? ` · Resend id ${invite.messageId}` : ""}{invite.error ? ` · ${invite.error}` : ""}</dd>
          <dt>Setup link</dt><dd>{{ none: "None issued", active: "Active", expired: "Expired", revoked: "Revoked / replaced" }[invite.linkState]}{invite.linkOpenedAt ? ` · first opened ${when(invite.linkOpenedAt)}` : " · not opened yet"}</dd>
          <dt>Customer details</dt><dd>{profile?.business_name ? `${profile.business_name} · ${profile.contact_name} · ${profile.business_email}` : "Not entered yet"}</dd>
          <dt>Website</dt><dd>{active.length ? active.map((d) => d.domain).join(", ") + " (authorized)" : "Not authorized yet"}</dd>
          <dt>CRM</dt><dd>{!conn ? "Not connected" : `${conn.provider === "highlevel" ? "GoHighLevel (OAuth)" : "Webhook"} · ${conn.status}${conn.last_checked_at && !conn.last_error ? " · test passed" : conn.last_error ? " · test failed" : " · not tested"}`}</dd>
          <dt>Installation</dt><dd>{installation ? <>{installation.status.replace(/_/g, " ")} <small>(confirmed by an administrator on the Installations page)</small></> : "No installation record"}</dd>
          <dt>Last activity</dt><dd>{when(progress.lastActivity)}</dd>
          <dt>Steps left</dt><dd>{progress.remaining.length ? progress.remaining.map((s) => s.label).join(", ") : "None"}</dd>
          {progress.attention.length > 0 && (<><dt>Needs attention</dt><dd>{progress.attention.join(" ")}</dd></>)}
        </dl>
      </div>
    </section>
  );
}
