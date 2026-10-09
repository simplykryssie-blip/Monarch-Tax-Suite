import { headers } from "next/headers";
import { BasicCalculator } from "@/components/calculator/basic-calculator";
import { EMBED_MESSAGES, hostFromHeader } from "@/lib/commerce/embed.ts";
import { loadEmbedDecision } from "@/lib/embed-server";

// Licensed, embeddable calculator. The proxy sets a per-license
// Content-Security-Policy frame-ancestors header so browsers only render this
// page inside the license's authorized domains, whatever platform hosts it.
export default async function EmbeddedCalculatorPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const h = await headers();
  const decision = await loadEmbedDecision(id ?? null, hostFromHeader(h.get("referer")));
  if (!decision.ok) {
    return (
      <main style={{ padding: 24, fontFamily: "Arial, Helvetica, sans-serif", color: "#3a3830", background: "#f6f4ee" }}>
        <p style={{ margin: 0, fontSize: 14 }}>{EMBED_MESSAGES[decision.reason]}</p>
      </main>
    );
  }
  return <BasicCalculator embedded />;
}
