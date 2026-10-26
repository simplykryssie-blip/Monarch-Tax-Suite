import { requireAdmin } from "@/lib/admin";
import { Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { appointmentDeps } from "@/lib/appointments/server";
import { NewAppointmentForm } from "@/components/calendar/new-appointment-form";

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
        <p className="monarch-panel" style={{ padding: 20 }}>Add an appointment type first (for example &quot;Tax prep consultation, 30 minutes&quot;) in <a href="/settings/calendar">Settings → Calendar</a>.</p>
      ) : (
        <NewAppointmentForm types={result.data.types.map((t) => ({ id: t.id, label: `${t.name} (${t.duration_minutes} min)` }))} tz={result.data.tz} />
      )}
    </>
  );
}
