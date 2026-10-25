import { FormattedInput } from "@/components/forms/formatted-input";
import type { Metadata } from "next";
import { MonthPicker } from "@/components/book/month-picker";
import { ThemedPage } from "@/components/forms/themed-page";
import { SubmitOnce } from "@/components/admin/submit-once";
import { bookingContext } from "@/lib/appointments/public";
import { listSlots } from "@/lib/appointments/service.ts";
import { brandedTheme } from "@/lib/branding/brand.ts";
import { loadBrand } from "@/lib/branding/server";
import { DEFAULT_THEME } from "@/lib/forms/theme.ts";
import { bookAction } from "../actions";

export const metadata: Metadata = { title: "Book an appointment", robots: { index: false, follow: false } };

/** An office's public booking page. No login; every booking is limited per visitor and checked again on the server. */
export default async function BookPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params;
  const { error } = await searchParams;
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
      {error && <p className="monarch-alert is-error" role="alert">{error}</p>}
      <form action={bookAction.bind(null, slug)} className="monarch-form">
        <h2 className="is-wide">1. Pick a time</h2>
        <div className="is-wide"><MonthPicker slots={slots.map((s) => s.start.toISOString())} officeTz={cal.timeZone} /></div>
        <h2 className="is-wide">2. Your details</h2>
        <label>Name<input name="name" required maxLength={200} autoComplete="name" /></label>
        <label>Email<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
        <label>Mobile number (optional)<FormattedInput kind="phone" name="phone" autoComplete="tel" /></label>
        <label className="is-wide"><input type="checkbox" name="sms_consent" /> Text me reminders about this appointment. Message and data rates may apply. Reply STOP to opt out. You can still book without this.</label>
        <label className="is-wide">Anything we should know? (optional)<textarea name="notes" rows={3} maxLength={1000} /></label>
        <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", height: 0, overflow: "hidden" }}><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
        <div className="is-wide"><SubmitOnce busy="Booking…">Book appointment</SubmitOnce></div>
      </form>
    </ThemedPage>
  );
}
