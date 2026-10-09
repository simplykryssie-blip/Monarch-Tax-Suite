import { headers } from "next/headers";
import { BasicCalculator } from "@/components/calculator/basic-calculator";
import { EMBED_MESSAGES, hostFromHeader } from "@/lib/commerce/embed.ts";
import { loadEmbed } from "@/lib/embed-server";

// Licensed, embeddable calculator. The proxy sets a per-license
// Content-Security-Policy frame-ancestors header so browsers only render this
// page inside the license's authorized domains, whatever platform hosts it.
export default async function EmbeddedCalculatorPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const h = await headers();
  const { decision, years } = await loadEmbed(id ?? null, hostFromHeader(h.get("referer")));
  if (!decision.ok) {
    return (
      <main style={{ padding: 24, fontFamily: "Arial, Helvetica, sans-serif", color: "#3a3830", background: "#f6f4ee" }}>
        <p style={{ margin: 0, fontSize: 14 }}>{EMBED_MESSAGES[decision.reason]}</p>
      </main>
    );
  }
  if (years.length === 0) {
    return (
      <main style={{ padding: 24, fontFamily: "Arial, Helvetica, sans-serif", color: "#3a3830", background: "#f6f4ee" }}>
        <p style={{ margin: 0, fontSize: 14 }}>This license does not include a tax year available in this calculator. Please contact Monarch Tax Suite.</p>
      </main>
    );
  }
  // Only the tax years this license has paid for (its version and earlier) are offered.
  return <BasicCalculator embedded maxTaxYear={years[0]} />;
}
