import Link from "next/link";
import { Badge } from "@/components/admin/ui";
import { whenFor } from "@/lib/appointments/messages.ts";
import { appointmentDeps } from "@/lib/appointments/server";

const clock = () => Date.now();

/** A contact's appointments: the next ones first, then the most recent past ones. Found by the email they booked with. */
export async function AppointmentsCard({ email }: { email: string | null }) {
  const deps = appointmentDeps();
  const [rows, types] = email ? await Promise.all([deps.repo.listForContact(email.trim().toLowerCase()).catch(() => []), deps.repo.listTypes().catch(() => [])]) : [[], []];
  const name = new Map(types.map((t) => [t.id, t.name]));
  const now = clock();
  const upcoming = rows.filter((a) => a.status === "booked" && Date.parse(a.starts_at) >= now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = rows.filter((a) => !upcoming.includes(a)).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const shown = [...upcoming, ...past].slice(0, 5);
  return (
    <section className="monarch-panel cl-card">
      <div className="cl-card-head"><h2>Appointments</h2><Link className="monarch-link" href="/calendar/new">Book one</Link></div>
      {shown.length === 0 ? <p className="monarch-muted cl-empty">None yet</p> : (
        <ul className="cl-list">
          {shown.map((a) => (
            <li key={a.id}>
              <span><b>{name.get(a.type_id) ?? "Appointment"}</b><small className="monarch-subcell">{whenFor(a)}</small></span>
              <Badge value={a.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
