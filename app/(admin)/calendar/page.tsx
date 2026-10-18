import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { Badge, Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { SubmitOnce } from "@/components/admin/submit-once";
import { appointmentDeps } from "@/lib/appointments/server";
import { addDays, parseYmd, ymdString, atLocal } from "@/lib/calendar/business.ts";
import { cancelAction, moveAction, outcomeAction } from "./actions";

type SP = { view?: string; date?: string; notice?: string; error?: string };
const VIEWS = { day: 1, week: 7, agenda: 30 } as const;
type View = keyof typeof VIEWS;

const localDay = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const heading = (day: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));
const time = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** The office calendar. The agenda (a list by day) is the default; it reads well on a phone. */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdmin();
  const sp = await searchParams;
  const view: View = sp.view === "day" || sp.view === "week" ? sp.view : "agenda";
  const deps = appointmentDeps();
  const result = await load(async () => {
    const cal = await deps.calendar();
    const today = localDay(new Date().toISOString(), cal.timeZone);
    const first = parseYmd(sp.date ?? "") ?? parseYmd(today)!;
    const days = VIEWS[view];
    const from = atLocal(first, 0, cal.timeZone);
    const to = atLocal(addDays(first, days), 0, cal.timeZone);
    const [appts, types] = await Promise.all([deps.repo.listAppointments(from, to), deps.repo.listTypes()]);
    return { tz: cal.timeZone, today, first, days, appts, types };
  });
  const base = (v: View, date?: string) => `/calendar?view=${v}${date ? `&date=${date}` : ""}`;
  return (
    <>
      <PageTitle title="Calendar">Appointments booked online or by your staff, in your office&apos;s time zone.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <SetupRequired message={result.message} /> : (() => {
        const { tz, today, first, days, appts, types } = result.data;
        const typeName = new Map(types.map((t) => [t.id, t.name]));
        const dates = Array.from({ length: days }, (_, i) => ymdString(addDays(first, i)));
        const byDay = new Map<string, typeof appts>();
        for (const a of appts) { const k = localDay(a.starts_at, tz); byDay.set(k, [...(byDay.get(k) ?? []), a]); }
        const step = days;
        const prev = ymdString(addDays(first, -step)), next = ymdString(addDays(first, step));
        return (
          <>
            <div className="monarch-toolbar" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
              {(["day", "week", "agenda"] as View[]).map((v) => <Link key={v} className={v === view ? "monarch-primary" : "monarch-secondary"} href={base(v, ymdString(first))}>{v === "agenda" ? "Agenda" : v === "day" ? "Day" : "Week"}</Link>)}
              <Link className="monarch-secondary" href={base(view, prev)} aria-label="Earlier">←</Link>
              <Link className="monarch-secondary" href={base(view, today)}>Today</Link>
              <Link className="monarch-secondary" href={base(view, next)} aria-label="Later">→</Link>
              <span style={{ flex: 1 }} />
              <Link className="monarch-primary" href="/calendar/new">New appointment</Link>
              <Link className="monarch-secondary" href="/calendar/types">Appointment types</Link>
              <Link className="monarch-secondary" href="/calendar/availability">Availability</Link>
            </div>
            {(view === "agenda" ? dates.filter((d) => byDay.has(d)) : dates).map((d) => (
              <section key={d} className="monarch-panel" style={{ padding: 16, marginBottom: 12 }}>
                <h2 style={{ marginTop: 0 }}>{heading(d)}{d === today ? " · Today" : ""}</h2>
                {(byDay.get(d) ?? []).length === 0 ? <p className="monarch-muted">Nothing booked.</p> : (
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
                    {byDay.get(d)!.map((a) => (
                      <li key={a.id} style={{ borderTop: "1px solid var(--monarch-line, #e5e7eb)", paddingTop: 10, opacity: a.status === "cancelled" ? 0.6 : 1 }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                          <strong>{time(a.starts_at, tz)}–{time(a.ends_at, tz)}</strong>
                          <span>{typeName.get(a.type_id) ?? "Appointment"} · {a.contact_name}</span>
                          <Badge value={a.status} />
                          {a.source === "public" && <span className="monarch-muted">booked online</span>}
                        </div>
                        <div className="monarch-muted">{a.contact_email}{a.contact_phone ? ` · ${a.contact_phone}` : ""}{a.sms_consent ? " · texts OK" : ""}</div>
                        {a.notes && <div style={{ whiteSpace: "pre-wrap" }}>{a.notes}</div>}
                        {a.status === "booked" && (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                            {Date.parse(a.starts_at) <= Date.now() && (
                              <>
                                <form action={outcomeAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="outcome" value="done" /><button className="monarch-secondary">Attended</button></form>
                                <form action={outcomeAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="outcome" value="no_show" /><button className="monarch-secondary">No-show</button></form>
                              </>
                            )}
                            <details>
                              <summary>Move</summary>
                              <form action={moveAction} className="monarch-form">
                                <input type="hidden" name="id" value={a.id} />
                                <label>New date and time<input type="datetime-local" name="starts_at" required /></label>
                                <SubmitOnce>Move appointment</SubmitOnce>
                              </form>
                            </details>
                            <details>
                              <summary>Cancel</summary>
                              <form action={cancelAction} className="monarch-form">
                                <input type="hidden" name="id" value={a.id} />
                                <label>Reason (optional)<input name="reason" maxLength={300} /></label>
                                <label><input type="checkbox" name="notify" defaultChecked /> Email {a.contact_name} that it&apos;s cancelled</label>
                                <SubmitOnce>Cancel appointment</SubmitOnce>
                              </form>
                            </details>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
            {view === "agenda" && byDay.size === 0 && <p className="monarch-muted">No appointments in the next 30 days.</p>}
            <p className="monarch-muted">Times are shown in {tz.replace(/_/g, " ")}. {types.length === 0 ? "Add an appointment type to start taking bookings." : ""}</p>
          </>
        );
      })()}
    </>
  );
}
