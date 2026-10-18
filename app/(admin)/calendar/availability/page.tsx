import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { SubmitOnce } from "@/components/admin/submit-once";
import { appointmentDeps } from "@/lib/appointments/server";
import { addOverrideAction, removeOverrideAction, saveWeeklyAction } from "../actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hm = (t: string | null) => (t ? t.slice(0, 5) : "");

/** When people can book. Nothing set means your business hours (and your closed days) apply. */
export default async function AvailabilityPage({ searchParams }: { searchParams: Promise<{ who?: string; notice?: string; error?: string }> }) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const who = sp.who === "me" ? "me" : "office";
  const deps = appointmentDeps();
  const result = await load(async () => ({ rules: await deps.repo.listRules(who === "me" ? admin.userId : null) }));
  return (
    <>
      <PageTitle title="Availability" back={{ href: "/calendar", label: "Calendar" }}>
        The hours clients can book. If you set nothing, your <Link href="/settings/business-hours">business hours</Link> apply. Closed days from business hours (holidays) always block booking unless you open that date below.
      </PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Link className={who === "office" ? "monarch-primary" : "monarch-secondary"} href="/calendar/availability?who=office">The office</Link>
        <Link className={who === "me" ? "monarch-primary" : "monarch-secondary"} href="/calendar/availability?who=me">My hours</Link>
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
              <div className="is-wide"><SubmitOnce>Save weekly hours</SubmitOnce></div>
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
                <div className="is-wide"><SubmitOnce>Save date</SubmitOnce></div>
              </form>
            </section>
          </>
        );
      })()}
    </>
  );
}
