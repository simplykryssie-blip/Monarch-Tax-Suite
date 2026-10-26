import type { Metadata } from "next";
import Link from "next/link";
import { ThemedPage } from "@/components/forms/themed-page";
import { bookingContext } from "@/lib/appointments/public";
import { brandedTheme } from "@/lib/branding/brand.ts";
import { loadBrand } from "@/lib/branding/server";
import { DEFAULT_THEME } from "@/lib/forms/theme.ts";

export const metadata: Metadata = { title: "Book an appointment", robots: { index: false, follow: false } };

/** An office's booking page: what can be booked. One link to share; each choice opens its own booking page. */
export default async function BookIndex() {
  const { tenantId, deps } = await bookingContext();
  const [brand, firm, types] = await Promise.all([loadBrand(tenantId).catch(() => null), deps.firmName().catch(() => ""), deps.repo.listTypes().catch(() => [])]);
  const theme = brandedTheme(DEFAULT_THEME, brand);
  const open = types.filter((t) => t.active);
  return (
    <ThemedPage theme={theme} firm={firm} poweredBy={!!brand?.showPoweredBy}>
      {firm && <div className="monarch-eyebrow">{firm.toUpperCase()}</div>}
      <h1>Book an appointment</h1>
      {open.length === 0 ? <p>Booking isn&apos;t open right now. Please contact the office.</p> : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
          {open.map((t) => (
            <li key={t.id} className="monarch-panel" style={{ padding: 16 }}>
              <h2 style={{ margin: "0 0 4px" }}><Link href={`/book/${t.slug}`}>{t.name}</Link></h2>
              <p className="monarch-muted" style={{ margin: 0 }}>{t.duration_minutes} minutes{t.location ? ` · ${t.location}` : ""}</p>
              {t.description && <p style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>{t.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </ThemedPage>
  );
}
