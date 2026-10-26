import type { Metadata } from "next";
import { BookingForm } from "@/components/book/booking-form";
import { ThemedPage } from "@/components/forms/themed-page";
import { bookingContext } from "@/lib/appointments/public";
import { listSlots } from "@/lib/appointments/service.ts";
import { brandedTheme } from "@/lib/branding/brand.ts";
import { loadBrand } from "@/lib/branding/server";
import { DEFAULT_THEME } from "@/lib/forms/theme.ts";

export const metadata: Metadata = { title: "Book an appointment", robots: { index: false, follow: false } };

/** An office's public booking page. No login; every booking is limited per visitor and checked again on the server. */
export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { tenantId, deps } = await bookingContext();
  const [brand, firm, type] = await Promise.all([loadBrand(tenantId).catch(() => null), deps.firmName().catch(() => ""), deps.repo.getTypeBySlug(slug).catch(() => null)]);
  const theme = brandedTheme(DEFAULT_THEME, brand);
  if (!type || !type.active) return <ThemedPage theme={theme} firm={firm}><h1>Booking isn&apos;t available</h1><p>This booking link is not valid or is not open right now. Please contact the office.</p></ThemedPage>;
  const cal = await deps.calendar();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: cal.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const slots = await listSlots(deps, type, today, Math.min(type.max_days_ahead, 90)).catch(() => []);
  return (
    <ThemedPage theme={theme} firm={firm} poweredBy={!!brand?.showPoweredBy}>
      {firm && <div className="monarch-eyebrow">{firm.toUpperCase()}</div>}
      <h1>{type.name}</h1>
      <p className="monarch-muted">{type.duration_minutes} minutes{type.location ? ` · ${type.location}` : ""}</p>
      {type.description && <p style={{ whiteSpace: "pre-wrap" }}>{type.description}</p>}
      <BookingForm slug={slug} slots={slots.map((x) => x.start.toISOString())} officeTz={cal.timeZone} />
    </ThemedPage>
  );
}
