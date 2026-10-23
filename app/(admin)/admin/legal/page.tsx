import { requirePlatformAdmin } from "@/lib/admin";
import { PageTitle } from "@/components/admin/ui";
import { billingProblems } from "@/lib/billing/plans.ts";
import { captchaConfigured } from "@/lib/billing/captcha.ts";
import { signupState } from "@/lib/billing/open.ts";
import { PLATFORM_LEGAL_APPROVED, PLATFORM_LEGAL_LAST_UPDATED, PLATFORM_LEGAL_PATHS, PLATFORM_LEGAL_VERSION } from "@/lib/platform-legal.ts";

const Row = ({ label, ok, detail }: { label: string; ok: boolean; detail: string }) => (
  <tr><td><b>{label}</b></td><td>{ok ? "✓ Ready" : "✗ Not yet"}</td><td style={{ whiteSpace: "normal" }}>{detail}</td></tr>
);

/** Whether Verexa HQ's policies are approved and self-serve signup is open. Read-only: it changes nothing. */
export default async function LegalStatusPage() {
  await requirePlatformAdmin();
  const env = process.env;
  const production = env.VERCEL_ENV === "production";
  const signup = signupState(env);
  const billing = billingProblems(env);
  return (
    <>
      <PageTitle title="Legal & signup">Where the signup gate stands. Read-only: nothing here opens or closes signup by itself.</PageTitle>
      <section className="monarch-panel"><div className="monarch-table-wrap"><table><thead><tr><th>ITEM</th><th>STATE</th><th>DETAILS</th></tr></thead><tbody>
        <Row label="Policies approved" ok={PLATFORM_LEGAL_APPROVED} detail={PLATFORM_LEGAL_APPROVED ? `Approved. Version ${PLATFORM_LEGAL_VERSION}, last updated ${PLATFORM_LEGAL_LAST_UPDATED}.` : `Still a draft (${PLATFORM_LEGAL_VERSION}). The ${PLATFORM_LEGAL_PATHS.length} policy pages answer 404 and nothing links to them. Approval is a reviewed change to the code (lib/platform-legal.ts), which also redeploys.`} />
        <Row label="Billing configured" ok={billing.length === 0} detail={billing.length === 0 ? "Verexa HQ's Stripe billing key and webhook secret are set." : billing.join(" ")} />
        <Row label="Bot check (Turnstile)" ok={captchaConfigured(env)} detail={captchaConfigured(env) ? "Site key and secret are set." : "TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are not both set in this deployment."} />
        <Row label="Self-serve signup" ok={signup.open} detail={signup.open ? (production ? "Open to the public." : "Open on this deployment (a Preview or local copy does not need the approval or the bot check).") : `Closed. ${signup.reasons.join(" ")}`} />
      </tbody></table></div></section>
      <p className="monarch-muted">Environment: {env.VERCEL_ENV ?? "development"}. Secrets are never shown; change them in Vercel.</p>
    </>
  );
}
