import Link from "next/link";
import { load, SetupRequired } from "@/components/admin/ui";
import { Modal } from "@/components/ui/modal";
import { SubmitOnce } from "@/components/admin/submit-once";
import { CopyLink } from "@/components/calendar/copy-link";
import { MessageFields } from "@/components/calendar/message-fields";
import { appointmentDeps } from "@/lib/appointments/server";
import type { AppointmentType, BookingMessages } from "@/lib/appointments/types.ts";
import { addOverrideAction, removeOverrideAction, saveBookingMessagesAction, saveTypeAction, saveWeeklyAction } from "../../calendar/actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hm = (t: string | null) => (t ? t.slice(0, 5) : "");

export type FormOption = { id: string; name: string };

function TypeForm({ t, forms }: { t?: AppointmentType; forms: FormOption[] }) {
  return (
    <form action={saveTypeAction} className="monarch-form">
      {t && <input type="hidden" name="id" value={t.id} />}
      <label>Name<input name="name" required maxLength={120} defaultValue={t?.name ?? ""} placeholder="Tax prep consultation" /></label>
      <label>Link name<input name="slug" maxLength={40} defaultValue={t?.slug ?? ""} placeholder="tax-prep-consult" pattern="[a-z0-9]([a-z0-9\-]{0,38}[a-z0-9])?" /></label>
      <label>Length (minutes)<input name="duration_minutes" type="number" min={5} max={480} defaultValue={t?.duration_minutes ?? 30} required /></label>
      <label>Start times every (minutes)<input name="step_minutes" type="number" min={5} max={240} defaultValue={t?.step_minutes ?? 30} /></label>
      <label>Buffer before (minutes)<input name="buffer_before_minutes" type="number" min={0} max={120} defaultValue={t?.buffer_before_minutes ?? 0} /></label>
      <label>Buffer after (minutes)<input name="buffer_after_minutes" type="number" min={0} max={120} defaultValue={t?.buffer_after_minutes ?? 0} /></label>
      <label>Minimum notice (minutes)<input name="min_notice_minutes" type="number" min={0} max={43200} defaultValue={t?.min_notice_minutes ?? 120} /></label>
      <label>Bookable up to (days ahead)<input name="max_days_ahead" type="number" min={1} max={365} defaultValue={t?.max_days_ahead ?? 60} /></label>
      <label>Reminders (hours before, up to three)<input name="reminder_hours" defaultValue={(t?.reminder_hours ?? [24]).join(", ")} placeholder="24, 2" /></label>
      <label>Whose calendar
        <select name="assignee" defaultValue={t?.assignee_id ? "me" : "office"}>
          <option value="office">The office (shared)</option>
          <option value="me">Me</option>
        </select>
      </label>
      <label className="is-wide">Form to fill in before the visit
        <select name="intake_form_id" defaultValue={t?.intake_form_id ?? ""}>
          <option value="">No form</option>
          {forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>
      <label className="is-wide">Where (address or meeting link, shown to the client)<input name="location" maxLength={300} defaultValue={t?.location ?? ""} /></label>
      <label className="is-wide">Description<textarea name="description" rows={3} maxLength={2000} defaultValue={t?.description ?? ""} /></label>
      <label className="is-wide"><input type="checkbox" name="active" defaultChecked={t ? t.active : true} /> Open for booking</label>
      <div className="is-wide"><SubmitOnce className="monarch-primary">{t ? "Save changes" : "Add appointment type"}</SubmitOnce></div>
    </form>
  );
}


/** One link for everything, and one for each appointment type. */
export function BookingLinks({ origin, types }: { origin: string; types: AppointmentType[] }) {
  const open = types.filter((t) => t.active);
  return (
    <section className="monarch-panel" style={{ padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>Booking links</h2>
      <ul className="cl-list">
        <li><span><b>All appointment types</b><small className="monarch-subcell">{origin}/book</small></span><span className="cl-card-actions"><CopyLink href="/book" label="Copy" className="monarch-link" /><Link className="monarch-link" href="/book" target="_blank">Open</Link></span></li>
        {open.map((t) => (
          <li key={t.id}><span><b>{t.name}</b><small className="monarch-subcell">{origin}/book/{t.slug}</small></span><span className="cl-card-actions"><CopyLink href={`/book/${t.slug}`} label="Copy" className="monarch-link" /><Link className="monarch-link" href={`/book/${t.slug}`} target="_blank">Open</Link></span></li>
        ))}
      </ul>
    </section>
  );
}

/** The appointment types as cards, each opening a popup to edit; a button to add one. */
export function TypeCards({ types, forms }: { types: AppointmentType[]; forms: FormOption[] }) {
  return (
    <section className="monarch-panel" style={{ padding: 20 }}>
      <div className="cl-card-head"><h2>Appointment types</h2><Modal label="Add appointment type" title="Add an appointment type" className="monarch-secondary" wide><TypeForm forms={forms} /></Modal></div>
      {types.length === 0 ? <p className="monarch-muted">None yet.</p> : (
        <div className="pl-grid">
          {types.map((t) => (
            <section key={t.id} className="monarch-panel pl-card" style={{ borderTopColor: t.active ? undefined : "#94a3b8" }}>
              <b className="pl-name">{t.name}</b>
              <dl className="pl-facts"><div><dt>Length</dt><dd>{t.duration_minutes} min</dd></div><div><dt>Booking</dt><dd>{t.active ? "Open" : "Closed"}</dd></div></dl>
              <span className="cl-card-actions">
                <Modal label="Edit" title={`Edit ${t.name}`} className="monarch-link" wide><TypeForm t={t} forms={forms} /></Modal>
              </span>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

/** When people can book: weekly hours and specific dates, for the office or for just you. */
export async function AvailabilitySection({ who, adminId }: { who: "office" | "me"; adminId: string }) {
  const deps = appointmentDeps();
  const result = await load(async () => ({ rules: await deps.repo.listRules(who === "me" ? adminId : null) }));
  return (
    <section className="monarch-panel" style={{ padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>Availability</h2>
      <p className="monarch-muted">The hours clients can book. If you set nothing, your business hours (on the firm profile) apply.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Link className={who === "office" ? "monarch-primary" : "monarch-secondary"} href="/settings/calendar?who=office">The office</Link>
        <Link className={who === "me" ? "monarch-primary" : "monarch-secondary"} href="/settings/calendar?who=me">My hours</Link>
      </div>
      {!result.ok ? <SetupRequired message={result.message} /> : (() => {
        const weekly = result.data.rules.filter((r) => r.weekday !== null);
        const dated = result.data.rules.filter((r) => r.on_date !== null).sort((a, b) => a.on_date!.localeCompare(b.on_date!));
        return (
          <>
            <form action={saveWeeklyAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
              <input type="hidden" name="who" value={who} />
              <h2>Weekly hours</h2>
              <p className="monarch-muted">{weekly.length ? "Days left unticked are closed for booking." : "Nothing saved yet: business hours are being used. Saving here replaces them for booking."}</p>
              {DAYS.map((name, d) => {
                const spans = weekly.filter((r) => r.weekday === d).sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));
                return (
                  <div key={d} className="is-wide" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <label style={{ minWidth: 130 }}><input type="checkbox" name={`open_${d}`} defaultChecked={spans.length > 0} /> {name}</label>
                    {[0, 1].map((i) => (
                      <span key={i} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                        <input type="time" name={`from${i + 1}_${d}`} defaultValue={hm(spans[i]?.start_time ?? (i === 0 && !weekly.length && d >= 1 && d <= 5 ? "09:00" : null))} aria-label={`${name} period ${i + 1} starts`} />
                        <span>to</span>
                        <input type="time" name={`to${i + 1}_${d}`} defaultValue={hm(spans[i]?.end_time ?? (i === 0 && !weekly.length && d >= 1 && d <= 5 ? "17:00" : null))} aria-label={`${name} period ${i + 1} ends`} />
                      </span>
                    ))}
                  </div>
                );
              })}
              <div className="is-wide"><SubmitOnce className="monarch-primary">Save weekly hours</SubmitOnce></div>
            </form>

            <section className="monarch-panel" style={{ padding: 20, marginTop: 16 }}>
              <h2 style={{ marginTop: 0 }}>Specific dates</h2>
              <p className="monarch-muted">Close a day, or open different hours on one date (for example, a Saturday before the filing deadline).</p>
              <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
                {dated.map((r) => (
                  <li key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong>{r.on_date}</strong> <span>{r.closed ? "Closed" : `${hm(r.start_time)} to ${hm(r.end_time)}`}</span>
                    <form action={removeOverrideAction}><input type="hidden" name="who" value={who} /><input type="hidden" name="id" value={r.id} /><button className="monarch-secondary">Remove</button></form>
                  </li>
                ))}
                {dated.length === 0 && <li className="monarch-muted">No specific dates yet.</li>}
              </ul>
              <form action={addOverrideAction} className="monarch-form">
                <input type="hidden" name="who" value={who} />
                <label>Date<input type="date" name="date" required /></label>
                <label><input type="checkbox" name="closed" /> Closed all day</label>
                <label>Open from<input type="time" name="from" /></label>
                <label>Until<input type="time" name="to" /></label>
                <div className="is-wide"><SubmitOnce className="monarch-primary">Save date</SubmitOnce></div>
              </form>
            </section>
          </>
        );
      })()}

    </section>
  );
}

/** The confirmation email and text, with tags to click instead of typing. */
export function MessagesSection({ messages }: { messages: BookingMessages | null }) {
  return (
    <section className="monarch-panel" style={{ padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>Confirmation email and text</h2>
      <form action={saveBookingMessagesAction} className="monarch-form">
        <MessageFields subject={messages?.confirm_subject ?? null} body={messages?.confirm_body ?? null} sms={messages?.confirm_sms ?? null} />
      </form>
    </section>
  );
}
