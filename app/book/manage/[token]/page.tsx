import type { Metadata } from "next";
import { MonthPicker } from "@/components/book/month-picker";
import { ThemedPage } from "@/components/forms/themed-page";
import { SubmitOnce } from "@/components/admin/submit-once";
import { bookingContext } from "@/lib/appointments/public";
import { whenFor } from "@/lib/appointments/messages.ts";
import { listSlots, lookupByToken } from "@/lib/appointments/service.ts";
import { brandedTheme } from "@/lib/branding/brand.ts";
import { loadBrand } from "@/lib/branding/server";
import { DEFAULT_THEME } from "@/lib/forms/theme.ts";
import { cancelAction, rescheduleAction } from "../../actions";

const clock = () => Date.now();

export const metadata: Metadata = { title: "Your appointment", robots: { index: false, follow: false } };

/** The link in a client's confirmation email: see the appointment, add it to a calendar, move it or cancel it. */
export default async function ManagePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ booked?: string; moved?: string; cancelled?: string; error?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const { tenantId, deps } = await bookingContext();
  const [brand, firm, found] = await Promise.all([loadBrand(tenantId).catch(() => null), deps.firmName().catch(() => ""), lookupByToken(deps, token)]);
  const theme = brandedTheme(DEFAULT_THEME, brand);
  if (!found) return <ThemedPage theme={theme} firm={firm}><h1>Link not valid</h1><p>This link isn&apos;t valid. Check that you copied the whole address from your email, or contact the office.</p></ThemedPage>;
  const { a, t } = found;
  const upcoming = a.status === "booked" && Date.parse(a.starts_at) > clock();
  const cal = upcoming ? await deps.calendar() : null;
  const slots = upcoming && cal ? await listSlots(deps, t, new Intl.DateTimeFormat("en-CA", { timeZone: cal.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), Math.min(t.max_days_ahead, 90), a.id).catch(() => []) : [];
  return (
    <ThemedPage theme={theme} firm={firm}>
      {firm && <div className="monarch-eyebrow">{firm.toUpperCase()}</div>}
      <h1>{sp.booked ? "You're booked" : sp.cancelled ? "Appointment cancelled" : sp.moved ? "Appointment moved" : "Your appointment"}</h1>
      {sp.error && <p className="monarch-alert is-error" role="alert">{sp.error}</p>}
      <div className="bk-summary"><b>{t.name}</b><span>{whenFor(a)}</span>{t.location ? <span><br />{t.location}</span> : null}</div>
      {a.status === "cancelled" && <p>This appointment has been cancelled.</p>}
      {a.status === "booked" && <div className="bk-actions"><a className="monarch-secondary" href={`/book/manage/${token}/ics`}>Add to my calendar</a></div>}
      {sp.booked && <p className="monarch-muted">We emailed you a confirmation with this link.</p>}
      {upcoming && (
        <>
          <details style={{ marginTop: 16 }}>
            <summary>Pick another time</summary>
            <form action={rescheduleAction.bind(null, token)} className="monarch-form">
              <div className="is-wide"><MonthPicker slots={slots.map((s) => s.start.toISOString())} officeTz={cal!.timeZone} /></div>
              <div className="is-wide"><SubmitOnce busy="Moving…">Move my appointment</SubmitOnce></div>
            </form>
          </details>
          <details style={{ marginTop: 12 }}>
            <summary>Cancel this appointment</summary>
            <form action={cancelAction.bind(null, token)} className="monarch-form">
              <label className="is-wide">Reason (optional)<input name="reason" maxLength={300} /></label>
              <div className="is-wide"><SubmitOnce busy="Cancelling…">Cancel appointment</SubmitOnce></div>
            </form>
          </details>
        </>
      )}
    </ThemedPage>
  );
}
