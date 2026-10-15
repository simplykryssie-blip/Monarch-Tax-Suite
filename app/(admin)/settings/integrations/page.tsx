import { requireSection } from "@/lib/tier-server";
import { Badge, EmptyRow, Flash, load, PageTitle, when } from "@/components/admin/ui";
import { emailConfig, checkSenderDomain } from "@/lib/automation/email.ts";
import { automationDeps, integrationStatus } from "@/lib/automation/server";
import { revokeLinkAction } from "../../automation/actions";

const Row = ({ label, ok, detail }: { label: string; ok: boolean; detail: string }) => (
  <tr><td><b>{label}</b></td><td>{ok ? "✓ Ready" : "✗ Needs attention"}</td><td style={{ whiteSpace: "normal" }}>{detail}</td></tr>
);

const currentTime = () => Date.now();

/** Every connection the app depends on, in one place. Read-only: secrets are never shown; change them in Vercel. */
export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireSection("bureau");
  const { notice, error } = await searchParams;
  const s = integrationStatus();
  const domain = await checkSenderDomain(emailConfig(process.env));
  const domainText = { verified: "verified in Resend", not_verified: "found in Resend but NOT verified; add its DNS records", not_found: "NOT found in Resend; add and verify this domain", unknown: "could not be checked" }[domain.status];
  const links = await load(() => automationDeps().repo.listLinks(20));
  const now = currentTime();
  return (
    <>
      <PageTitle title="Integrations">The connections the app depends on. Read-only: secrets are never shown; change them in Vercel.</PageTitle>
      <Flash notice={notice} error={error} />
      <section className="monarch-panel"><div className="monarch-table-wrap"><table><thead><tr><th>CONNECTION</th><th>STATE</th><th>DETAILS</th></tr></thead><tbody>
        <Row label="Resend (email)" ok={s.resend.configured} detail={s.resend.configured ? `Key from ${s.resend.keySource}. Sending as ${s.resend.sender}${s.resend.replyTo ? `, replies to ${s.resend.replyTo}` : ""}. Sender domain ${domain.domain ?? "unknown"}: ${domainText}.` : s.resend.problems.join(" ")} />
        <Row label="GoHighLevel app" ok={s.highlevel.appConfigured} detail={s.highlevel.appConfigured ? "Client ID and secret are set." : "HIGHLEVEL_CLIENT_ID / HIGHLEVEL_CLIENT_SECRET are not set."} />
        <Row label="Stripe" ok={s.stripe.secretKey && s.stripe.webhookSecret} detail={`Secret key ${s.stripe.secretKey ? "set" : "missing"} (${s.stripe.mode} mode); webhook secret ${s.stripe.webhookSecret ? "set" : "missing"}.`} />
        <Row label="Encryption key (setup links)" ok={s.app.encryptionKey} detail={s.app.encryptionKey ? "Present." : "MONARCH_ENCRYPTION_KEY is missing, so setup links cannot work."} />
        <Row label="Retry scheduler" ok={s.app.schedulerSecret} detail={s.app.schedulerSecret ? "CRON_SECRET is set. Retries and the daily renewal, signature, form and compliance sweeps run once a day (11:00 UTC) from Vercel Cron." : "CRON_SECRET is not set, so scheduled retries are off. Failed items can still be retried by hand from Run history."} />
        <Row label="App address" ok={Boolean(s.app.appUrl)} detail={s.app.appUrl ?? "NEXT_PUBLIC_APP_URL is not set; links use the request address."} />
      </tbody></table></div></section>
      <p className="monarch-muted">Environment: {s.app.environment}. {s.app.environment !== "production" ? `Test recipient allow-list: ${s.app.testRecipients} address(es).` : ""}</p>
      <section className="monarch-panel"><div className="monarch-panel-head"><div><h2>Customer setup links</h2><p>Only a hash of each link is stored. Links expire after 14 days and can be revoked.</p></div></div>
        <div className="monarch-table-wrap"><table><thead><tr><th>LICENSE</th><th>CREATED</th><th>EXPIRES</th><th>OPENED</th><th>STATE</th><th></th></tr></thead><tbody>
          {!links.ok || links.data.length === 0 ? <EmptyRow colSpan={6}>No setup links yet.</EmptyRow> : links.data.map((l) => {
            const state = l.revoked_at ? "revoked" : Date.parse(l.expires_at) <= now ? "expired" : "active";
            return <tr key={l.id}><td><a href={`/licenses/${l.license_id}`}>License</a></td><td>{when(l.created_at)}</td><td>{when(l.expires_at)}</td><td>{when(l.first_opened_at)}</td><td><Badge value={state} /></td><td>{state === "active" && <form action={revokeLinkAction}><input type="hidden" name="id" value={l.id} /><button className="monarch-link">Revoke</button></form>}</td></tr>;
          })}
        </tbody></table></div></section>
    </>
  );
}
