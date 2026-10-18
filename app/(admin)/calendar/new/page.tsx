import { requireAdmin } from "@/lib/admin";
import { Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { SubmitOnce } from "@/components/admin/submit-once";
import { appointmentDeps } from "@/lib/appointments/server";
import { bookAction } from "../actions";

/** Staff book an appointment for someone: any time they choose, as long as it doesn't overlap another booking. */
export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; name?: string; email?: string; phone?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const deps = appointmentDeps();
  const result = await load(async () => ({ types: (await deps.repo.listTypes()).filter((t) => t.active), tz: (await deps.calendar()).timeZone }));
  return (
    <>
      <PageTitle title="New appointment" back={{ href: "/calendar", label: "Calendar" }}>Book a client or prospect yourself. They get a confirmation email with a link to change it.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <SetupRequired message={result.message} /> : result.data.types.length === 0 ? (
        <p className="monarch-panel" style={{ padding: 20 }}>Add an appointment type first (for example &quot;Tax prep consultation, 30 minutes&quot;) on the <a href="/calendar/types">Appointment types</a> page.</p>
      ) : (
        <form action={bookAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
          <label>Appointment type
            <select name="type_id" required>{result.data.types.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.duration_minutes} min)</option>)}</select>
          </label>
          <label>Date and time ({result.data.tz.replace(/_/g, " ")})<input type="datetime-local" name="starts_at" required /></label>
          <label>Name<input name="name" required maxLength={200} defaultValue={sp.name ?? ""} autoComplete="off" /></label>
          <label>Email<input name="email" type="email" required maxLength={254} defaultValue={sp.email ?? ""} autoComplete="off" /></label>
          <label>Mobile number (optional)<input name="phone" maxLength={40} defaultValue={sp.phone ?? ""} autoComplete="off" /></label>
          <label className="is-wide"><input type="checkbox" name="sms_consent" /> This person agreed to receive text reminders</label>
          <label className="is-wide">Notes<textarea name="notes" rows={3} maxLength={1000} /></label>
          <div className="is-wide"><SubmitOnce>Book appointment</SubmitOnce></div>
        </form>
      )}
    </>
  );
}
