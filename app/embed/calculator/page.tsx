import type { Metadata } from "next";
import { headers } from "next/headers";
import { FullCalculator } from "@/components/calculator/full-calculator";
import { FULL_TAX_YEAR } from "@/lib/calculator/full";
import { EMBED_MESSAGES, hostFromHeader } from "@/lib/commerce/embed.ts";
import { loadEmbed } from "@/lib/embed-server";
import { issueEmbedToken, leadCaptureActive } from "@/lib/crm/leads.ts";
import { crmDeps } from "@/lib/crm/server";
import type { LeadCaptureConfig } from "@/components/calculator/lead-form";

/** The buyer's lead form, when they turned it on with a working GoHighLevel connection. Fails closed (no form). */
async function leadCaptureFor(licenseId: string, host: string | null): Promise<LeadCaptureConfig | undefined> {
  try {
    const deps = crmDeps();
    const settings = (await leadCaptureActive(deps, licenseId))?.settings;
    if (!settings?.business_name) return undefined;
    return { token: issueEmbedToken(deps, licenseId, host), businessName: settings.business_name, includeSummary: settings.include_summary };
  } catch {
    return undefined;
  }
}

export const metadata: Metadata = { title: "Tax Calculator", description: "Estimate your federal income tax.", robots: { index: false, follow: false } };

// Licensed, embeddable calculator. The proxy sets a per-license
// Content-Security-Policy frame-ancestors header so browsers only render this
// page inside the license's authorized domains, whatever platform hosts it.
export default async function EmbeddedCalculatorPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const h = await headers();
  const host = hostFromHeader(h.get("referer"));
  const { decision, years, licenseId } = await loadEmbed(id ?? null, host);
  if (!decision.ok) {
    return (
      <main style={{ padding: 24, fontFamily: "Arial, Helvetica, sans-serif", color: "#3a3830", background: "#f6f4ee" }}>
        <p style={{ margin: 0, fontSize: 14 }}>{EMBED_MESSAGES[decision.reason]}</p>
      </main>
    );
  }
  if (!years.includes(FULL_TAX_YEAR)) {
    return (
      <main style={{ padding: 24, fontFamily: "Arial, Helvetica, sans-serif", color: "#3a3830", background: "#f6f4ee" }}>
        <p style={{ margin: 0, fontSize: 14 }}>This license does not include the 2026 tax year. Please contact Monarch Tax Suite.</p>
      </main>
    );
  }
  // Only the tax years this license has paid for (its version and earlier) are offered.
  const leadCapture = licenseId ? await leadCaptureFor(licenseId, host) : undefined;
  return <FullCalculator leadCapture={leadCapture} />;
}
