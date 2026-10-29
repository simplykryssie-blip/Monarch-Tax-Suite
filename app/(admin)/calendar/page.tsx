import Link from "next/link";
import { appOrigin, requireAdmin } from "@/lib/admin";
import { Badge, Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { SubmitOnce } from "@/components/admin/submit-once";
import { formDeps } from "@/lib/forms/server";
import { intakeStatus } from "@/lib/appointments/intake.ts";
import { appointmentDeps } from "@/lib/appointments/server";
import { addDays, parseYmd, ymdString, atLocal } from "@/lib/calendar/business.ts";
import { monthGridStart, shiftMonth } from "@/lib/calendar/grid.ts";
import { openTasks, tasksDueBetween } from "@/lib/workspace/workflow-tasks";
import { Modal } from "@/components/ui/modal";
import { ViewPicker } from "@/components/calendar/view-picker";
import { TaskCheck } from "@/components/calendar/task-check";
import { CopyLink } from "@/components/calendar/copy-link";
import { workspaceRepo } from "@/lib/workspace/server";
import { addTaskAction } from "@/app/(admin)/workspace/actions";
import { toggleTaskAction } from "@/app/(admin)/workspace/actions";
import { cancelAction, moveAction, outcomeAction, resendConfirmationAction } from "./actions";

type SP = { view?: string; date?: string; notice?: string; error?: string };
const VIEWS = { month: 42, week: 7, day: 1, agenda: 30 } as const;
type View = keyof typeof VIEWS;

const localDay = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const heading = (day: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));
const time = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** The office calendar: a month grid by default, or a week, a day, or an agenda (a list by day, easy on a phone). Open tasks sit on the right. */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdmin();
  const sp = await searchParams;
  const view: View = sp.view === "day" || sp.view === "week" || sp.view === "agenda" ? sp.view : "month";
  const deps = appointmentDeps();
  const result = await load(async () => {
    const cal = await deps.calendar();
    const today = localDay(new Date().toISOString(), cal.timeZone);
    const anchor = parseYmd(sp.date ?? "") ?? parseYmd(today)!;
    // A month shows whole weeks: from the Sunday on or before the 1st, for six weeks.
    const first = view === "month" ? monthGridStart(anchor) : anchor;
    const days = VIEWS[view];
    const from = atLocal(first, 0, cal.timeZone);
    const to = atLocal(addDays(first, days), 0, cal.timeZone);
    const [appts, types, tasks, open, clients] = await Promise.all([deps.repo.listAppointments(from, to), deps.repo.listTypes(), tasksDueBetween(ymdString(first), ymdString(addDays(first, days))), openTasks(60), workspaceRepo().listClients({ includeArchived: false }).catch(() => [])]);
    // Which appointments have had their form filled in (only types that ask for one).
    const formIds = [...new Set(types.map((t) => t.intake_form_id).filter((f): f is string => !!f))];
    const subs = formIds.length ? (await Promise.all(formIds.map((f) => formDeps().repo.listSubmissions(f, { limit: 500 }).then((r) => r.rows).catch(() => [])))).flat() : [];
    const intake = intakeStatus(appts, types, subs);
    return { tz: cal.timeZone, today, first, anchor, days, appts, types, tasks, open, clients, intake, origin: await appOrigin() };
  });
  const base = (v: View, date?: string) => `/calendar?view=${v}${date ? `&date=${date}` : ""}`;
  return (
    <>
      <PageTitle title="Calendar">Appointments booked online or by your staff, in your office&apos;s time zone.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <SetupRequired message={result.message} /> : (() => {
        const { tz, today, first, anchor, days, appts, types, tasks, open, clients, intake, origin } = result.data;
        const tasksByDay = new Map<string, typeof tasks>();
        for (const t of tasks) tasksByDay.set(t.due_on, [...(tasksByDay.get(t.due_on) ?? []), t]);
        const typeName = new Map(types.map((t) => [t.id, t.name]));
        const dates = Array.from({ length: days }, (_, i) => ymdString(addDays(first, i)));
        const byDay = new Map<string, typeof appts>();
        for (const a of appts) { const k = localDay(a.starts_at, tz); byDay.set(k, [...(byDay.get(k) ?? []), a]); }
        // Month arrows move a whole month; the others move by the length of the view.
        const prev = view === "month" ? shiftMonth(anchor, -1) : ymdString(addDays(first, -days)), next = view === "month" ? shiftMonth(anchor, 1) : ymdString(addDays(first, days));
        const here = `/calendar?view=${view}&date=${ymdString(view === "month" ? anchor : first)}`;
        const monthTitle = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(anchor.y, anchor.m - 1, 1)));
        return (
          <div className="cal-layout">
            <div className="cal-main">
            <div className="monarch-toolbar" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
              <ViewPicker view={view} date={ymdString(view === "month" ? anchor : first)} />
              <Link className="monarch-secondary" href={base(view, prev)} aria-label="Earlier">←</Link>
              <Link className="monarch-secondary" href={base(view, today)}>Today</Link>
              <Link className="monarch-secondary" href={base(view, next)} aria-label="Later">→</Link>
              <span style={{ flex: 1 }} />
              <Link className="monarch-primary" href="/calendar/new">New appointment</Link>
              <Modal label="Booking links" title="Booking links" className="monarch-secondary">
                <ul className="cl-list">
                  <li><span><b>All appointment types</b><small className="monarch-subcell">{origin}/book</small></span><span className="cl-card-actions"><CopyLink href="/book" label="Copy" className="monarch-link" /></span></li>
                  {types.filter((t) => t.active).map((t) => <li key={t.id}><span><b>{t.name}</b><small className="monarch-subcell">{origin}/book/{t.slug}</small></span><span className="cl-card-actions"><CopyLink href={`/book/${t.slug}`} label="Copy" className="monarch-link" /></span></li>)}
                </ul>
                <p className="monarch-muted">Change your hours, types and messages in <Link href="/settings/calendar">Settings → Booking and hours</Link>.</p>
              </Modal>
            </div>
            {view === "month" && (
              <>
                <h2 className="cal-month-title">{monthTitle}</h2>
                <div className="cal-month" role="grid" aria-label={monthTitle}>
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => <div key={w} className="cal-dow" role="columnheader">{w}</div>)}
                  {dates.map((d) => {
                    const items = [...(byDay.get(d) ?? []).filter((a) => a.status !== "cancelled").map((a) => ({ key: a.id, kind: "appt" as const, text: `${time(a.starts_at, tz)} ${a.contact_name}`, href: base("day", d) })), ...(tasksByDay.get(d) ?? []).map((x) => ({ key: x.id, kind: "task" as const, text: x.title, href: x.clientId ? `/workspace/clients/${x.clientId}` : base("day", d) }))];
                    const inMonth = Number(d.slice(5, 7)) === anchor.m;
                    return (
                      <div key={d} role="gridcell" className={"cal-cell" + (inMonth ? "" : " is-out") + (d === today ? " is-today" : "")}>
                        <Link className="cal-num" href={base("day", d)} aria-label={heading(d)}>{Number(d.slice(8))}</Link>
                        {items.slice(0, 3).map((it) => <Link key={it.key} href={it.href} className={`cal-item is-${it.kind}`} title={it.text}>{it.kind === "task" ? "☐ " : ""}{it.text}</Link>)}
                        {items.length > 3 && <Link className="cal-more" href={base("day", d)}>+{items.length - 3} more</Link>}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {view !== "month" && (view === "agenda" ? dates.filter((d) => byDay.has(d) || tasksByDay.has(d)) : dates).map((d) => (
              <section key={d} className="monarch-panel" style={{ padding: 16, marginBottom: 12 }}>
                <h2 style={{ marginTop: 0 }}>{heading(d)}{d === today ? " · Today" : ""}</h2>
                {(byDay.get(d) ?? []).length === 0 && !tasksByDay.has(d) ? <p className="monarch-muted">Nothing booked.</p> : (byDay.get(d) ?? []).length === 0 ? null : (
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
                    {byDay.get(d)!.map((a) => (
                      <li key={a.id} style={{ borderTop: "1px solid var(--monarch-line, #e5e7eb)", paddingTop: 10, opacity: a.status === "cancelled" ? 0.6 : 1 }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                          <strong>{time(a.starts_at, tz)}–{time(a.ends_at, tz)}</strong>
                          <span>{typeName.get(a.type_id) ?? "Appointment"} · {a.contact_name}</span>
                          <Badge value={a.status} />
                          {a.source === "public" && <span className="monarch-muted">booked online</span>}
                          {a.status === "booked" && intake.has(a.id) && <span className="monarch-muted">{intake.get(a.id) === "done" ? "Form filled in" : "Form not filled in yet"}</span>}
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
                            {Date.parse(a.starts_at) > Date.now() && (
                              <form action={resendConfirmationAction}><input type="hidden" name="id" value={a.id} /><button className="monarch-secondary">Resend confirmation</button></form>
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
                {(tasksByDay.get(d) ?? []).length > 0 && (
                  <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 8 }}>
                    {tasksByDay.get(d)!.map((t) => (
                      <li key={t.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                        <span className="monarch-muted">Task</span> <strong>{t.title}</strong>
                        {t.clientId ? <Link href={`/workspace/clients/${t.clientId}`}>{t.clientName}</Link> : <span>{t.clientName}</span>}
                        <span style={{ flex: 1 }} />
                        {t.clientId && t.source !== "workflow" && <Link className="monarch-link" href={`/workspace/clients/${t.clientId}?tab=tasks`}>Edit</Link>}
                        <form action={toggleTaskAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="source" value={t.source === "workflow" ? "workflow" : ""} /><input type="hidden" name="back" value={`/calendar?view=${view}&date=${ymdString(first)}`} /><input type="hidden" name="done" value="yes" /><button className="monarch-link">Done</button></form>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
            {view !== "month" && view === "agenda" && byDay.size === 0 && tasksByDay.size === 0 && <p className="monarch-muted">No appointments in the next 30 days.</p>}
            <p className="monarch-muted">{`Times are shown in ${tz.replace(/_/g, " ")}. ${types.length === 0 ? "Add an appointment type to start taking bookings." : ""}`}</p>
            </div>
            <aside className="cal-side monarch-panel" aria-label="Tasks">
              <h2>Tasks</h2>
              {clients.length > 0 && (
                <Modal label="Add a task" title="Add a task" className="monarch-secondary">
                  <form action={addTaskAction} className="monarch-form">
                    <input type="hidden" name="back" value={here} />
                    <label>Contact *<select name="client_id" required defaultValue=""><option value="" disabled>Choose a contact…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></label>
                    <label>Due date<input name="due_on" type="date" /></label>
                    <label className="is-wide">Task *<textarea name="title" required rows={4} maxLength={200} placeholder="What needs to be done?" /></label>
                    <div className="is-wide"><button className="monarch-primary">Add task</button></div>
                  </form>
                </Modal>
              )}
              {open.length === 0 ? <p className="monarch-muted">Nothing to do.</p> : (
                <ul className="cal-tasks">
                  {open.map((x) => (
                    <li key={x.id}>
                      <TaskCheck id={x.id} source={x.source} back={here} title={x.title} />
                      <span>
                        <b>{x.title}</b>
                        <small className={x.due_on && x.due_on < today ? "wb-late" : "monarch-muted"}>{x.clientId ? <Link href={`/workspace/clients/${x.clientId}`}>{x.clientName}</Link> : x.clientName}{x.due_on ? ` · ${x.due_on < today ? "overdue " : "due "}${x.due_on}` : ""}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          </div>
        );
      })()}
    </>
  );
}
