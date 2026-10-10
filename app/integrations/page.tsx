import type { Metadata } from "next";
import { NewLinkForm } from "@/components/integrations/new-link-form";
import { SetupForms } from "@/components/integrations/setup-forms";
import { cookies } from "next/headers";
import { readPendingInstall } from "@/lib/crm/connection.ts";
import { SETUP_COOKIE } from "@/lib/automation/onboarding.ts";
import { crmConfigStatus, crmDeps, PENDING_COOKIE } from "@/lib/crm/server";

export const metadata: Metadata = { title: "Set up your calculator | Monarch Tax Suite", robots: { index: false, follow: false } };

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { notice, error } = await searchParams;
  const config = crmConfigStatus();
  const jar = await cookies();
  const sealed = jar.get(PENDING_COOKIE)?.value;
  const pending = config.encryption && config.highlevelConnect && sealed ? readPendingInstall(crmDeps(), sealed) : null;
  return (
    <main className="monarch-public">
      <div className="monarch-public-card intg-card">
        <div className="monarch-eyebrow">MONARCH TAX SUITE · SETUP</div>
        <h1>Set up your calculator</h1>
        <p>Confirm your details and website, choose where your leads should go, test it, then add the calculator to your page. Monarch Tax Suite doesn&apos;t store your leads. They go straight to your own CRM account.</p>
        {error && <p className="monarch-alert is-error" role="alert">{error}</p>}
        {notice && <p className="monarch-alert" role="status">{notice}</p>}
        {!jar.get(SETUP_COOKIE)?.value && <NewLinkForm />}
        {config.encryption ? <SetupForms highlevelAvailable={config.highlevelConnect} pending={pending} linked={Boolean(jar.get(SETUP_COOKIE)?.value)} /> : <p className="monarch-notice"><b>NOT AVAILABLE YET</b> Lead destinations are being set up. Please contact info@monarchtaxsuite.com.</p>}
      </div>
    </main>
  );
}
