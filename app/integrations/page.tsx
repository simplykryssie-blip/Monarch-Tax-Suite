import type { Metadata } from "next";
import { SetupForms } from "@/components/integrations/setup-forms";
import { crmConfigStatus } from "@/lib/crm/server";

export const metadata: Metadata = { title: "Lead destination setup | Monarch Tax Suite", robots: { index: false, follow: false } };

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { notice, error } = await searchParams;
  const config = crmConfigStatus();
  return (
    <main className="monarch-public">
      <div className="monarch-public-card intg-card">
        <div className="monarch-eyebrow">MONARCH TAX SUITE · CALCULATOR SETUP</div>
        <h1>Send calculator leads to your CRM</h1>
        <p>
          Leads from your calculator go straight to your own GoHighLevel sub-account or webhook. Monarch does not store them, email them or keep a lead history. If your destination is down, the
          visitor sees an error and can try again; nothing is saved.
        </p>
        {error && <p className="monarch-alert is-error" role="alert">{error}</p>}
        {notice && <p className="monarch-alert" role="status">{notice}</p>}
        {config.encryption ? <SetupForms highlevelAvailable={config.highlevel} emailAvailable={config.email} /> : <p className="monarch-notice"><b>NOT AVAILABLE YET</b> Lead destinations are being set up. Please contact info@monarchtaxsuite.com.</p>}
      </div>
    </main>
  );
}
