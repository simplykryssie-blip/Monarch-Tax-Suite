import { Flash, PageTitle } from "@/components/admin/ui";
import { emailConfig, checkSenderDomain } from "@/lib/automation/email.ts";
import { integrationStatus } from "@/lib/automation/server";

const Row = ({ label, ok, detail }: { label: string; ok: boolean; detail: string }) => (
  <tr><td><b>{label}</b></td><td>{ok ? "✓ Ready" : "✗ Needs attention"}</td><td style={{ whiteSpace: "normal" }}>{detail}</td></tr>
);

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { notice, error } = await searchParams;
  const s = integrationStatus();
  const domain = await checkSenderDomain(emailConfig(process.env));
  const domainText = { verified: "verified in Resend", not_verified: "found in Resend but NOT verified; add its DNS records", not_found: "NOT found in Resend; add and verify this domain", unknown: "could not be checked" }[domain.status];
  return (
    <>
      <PageTitle title="Automation settings">Read-only status of the connections the Automation Center depends on. Secrets are never shown; change them in Vercel.</PageTitle>
      <Flash notice={notice} error={error} />
      <section className="monarch-panel"><div className="monarch-table-wrap"><table><thead><tr><th>CONNECTION</th><th>STATE</th><th>DETAILS</th></tr></thead><tbody>
        <Row label="Resend (email)" ok={s.resend.configured} detail={s.resend.configured ? `Key from ${s.resend.keySource}. Sending as ${s.resend.sender}${s.resend.replyTo ? `, replies to ${s.resend.replyTo}` : ""}. Sender domain ${domain.domain ?? "unknown"}: ${domainText}.` : s.resend.problems.join(" ")} />
        <Row label="GoHighLevel app" ok={s.highlevel.appConfigured} detail={s.highlevel.appConfigured ? "Client ID and secret are set." : "HIGHLEVEL_CLIENT_ID / HIGHLEVEL_CLIENT_SECRET are not set."} />
        <Row label="Stripe" ok={s.stripe.secretKey && s.stripe.webhookSecret} detail={`Secret key ${s.stripe.secretKey ? "set" : "missing"} (${s.stripe.mode} mode); webhook secret ${s.stripe.webhookSecret ? "set" : "missing"}.`} />
        <Row label="Encryption key (setup links)" ok={s.app.encryptionKey} detail={s.app.encryptionKey ? "Present." : "MONARCH_ENCRYPTION_KEY is missing, so setup links cannot work."} />
        <Row label="Retry scheduler" ok={s.app.schedulerSecret} detail={s.app.schedulerSecret ? "CRON_SECRET is set. Point a scheduler at /api/automation/run." : "CRON_SECRET is not set, so scheduled retries are off. Failed items can still be retried by hand."} />
        <Row label="App address" ok={Boolean(s.app.appUrl)} detail={s.app.appUrl ?? "NEXT_PUBLIC_APP_URL is not set; links use the request address."} />
      </tbody></table></div></section>
      <p className="monarch-muted">Environment: {s.app.environment}. {s.app.environment !== "production" ? `Test recipient allow-list: ${s.app.testRecipients} address(es).` : ""}</p>
    </>
  );
}
