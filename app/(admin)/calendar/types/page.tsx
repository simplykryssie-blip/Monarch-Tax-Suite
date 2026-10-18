import { requireAdmin } from "@/lib/admin";
import { Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { SubmitOnce } from "@/components/admin/submit-once";
import { appointmentDeps } from "@/lib/appointments/server";
import { appOrigin } from "@/lib/admin";
import type { AppointmentType } from "@/lib/appointments/types.ts";
import { saveTypeAction } from "../actions";

function TypeForm({ t }: { t?: AppointmentType }) {
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
      <label className="is-wide">Where (address or meeting link, shown to the client)<input name="location" maxLength={300} defaultValue={t?.location ?? ""} /></label>
      <label className="is-wide">Description<textarea name="description" rows={3} maxLength={2000} defaultValue={t?.description ?? ""} /></label>
      <label className="is-wide"><input type="checkbox" name="active" defaultChecked={t ? t.active : true} /> Open for booking</label>
      <div className="is-wide"><SubmitOnce>{t ? "Save changes" : "Add appointment type"}</SubmitOnce></div>
    </form>
  );
}

export default async function TypesPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const deps = appointmentDeps();
  const result = await load(async () => ({ types: await deps.repo.listTypes(), origin: await appOrigin() }));
  return (
    <>
      <PageTitle title="Appointment types" back={{ href: "/calendar", label: "Calendar" }}>What clients can book. Each type has its own booking link you can share or put on your website.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <SetupRequired message={result.message} /> : (
        <>
          {result.data.types.map((t) => (
            <details key={t.id} className="monarch-panel" style={{ padding: 16, marginBottom: 12 }}>
              <summary><strong>{t.name}</strong> · {t.duration_minutes} min{t.active ? "" : " · closed"}</summary>
              <p className="monarch-muted">Booking link: <code>{result.data.origin}/book/{t.slug}</code></p>
              <TypeForm t={t} />
            </details>
          ))}
          <section className="monarch-panel" style={{ padding: 16 }}>
            <h2 style={{ marginTop: 0 }}>Add an appointment type</h2>
            <TypeForm />
          </section>
        </>
      )}
    </>
  );
}
