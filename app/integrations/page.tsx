import type { Metadata } from "next";
import { SetupForms } from "@/components/integrations/setup-forms";
import { crmConfigStatus } from "@/lib/crm/server";

export const metadata: Metadata = { title: "Set up your calculator | Monarch Tax Suite", robots: { index: false, follow: false } };

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { notice, error } = await searchParams;
  const config = crmConfigStatus();
  return (
    <main className="monarch-public">
      <div className="monarch-public-card intg-card">
        <div className="monarch-eyebrow">MONARCH TAX SUITE · SETUP</div>
        <h1>Set up your calculator</h1>
        <p>Three quick steps: activate your calculator, choose where your leads should go, then test it. Monarch Tax Suite doesn&apos;t store your leads. They go straight to your own CRM account.</p>
        {error && <p className="monarch-alert is-error" role="alert">{error}</p>}
        {notice && <p className="monarch-alert" role="status">{notice}</p>}
        {config.encryption ? <SetupForms highlevelAvailable={config.highlevel} /> : <p className="monarch-notice"><b>NOT AVAILABLE YET</b> Lead destinations are being set up. Please contact info@monarchtaxsuite.com.</p>}
      </div>
    </main>
  );
}
