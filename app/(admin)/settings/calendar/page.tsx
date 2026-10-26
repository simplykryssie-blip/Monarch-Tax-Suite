import { appOrigin, requireAdmin } from "@/lib/admin";
import { Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { formDeps } from "@/lib/forms/server";
import { appointmentDeps } from "@/lib/appointments/server";
import { AvailabilitySection, BookingLinks, MessagesSection, TypeCards } from "./sections";

/** Everything behind the calendar: what can be booked, the links to share, when you're available, and what clients are sent. */
export default async function CalendarSettingsPage({ searchParams }: { searchParams: Promise<{ who?: string; notice?: string; error?: string }> }) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const who = sp.who === "me" ? "me" : "office";
  const deps = appointmentDeps();
  const result = await load(async () => ({ types: await deps.repo.listTypes(), origin: await appOrigin(), messages: await deps.repo.getMessages().catch(() => null), forms: (await formDeps().repo.listForms().catch(() => [])).filter((f) => f.status === "published").map((f) => ({ id: f.id, name: f.name })) }));
  return (
    <>
      <PageTitle title="Calendar">Appointment types, booking links, availability and the messages clients get.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <SetupRequired message={result.message} /> : (
        <div style={{ display: "grid", gap: 16 }}>
          <TypeCards types={result.data.types} forms={result.data.forms} />
          <BookingLinks origin={result.data.origin} types={result.data.types} />
          <AvailabilitySection who={who} adminId={admin.userId} />
          <MessagesSection messages={result.data.messages} />
        </div>
      )}
    </>
  );
}
