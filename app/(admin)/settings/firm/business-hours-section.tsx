import { requireAdmin } from "@/lib/admin";
import { documentDeps } from "@/lib/documents/server";
import { businessDeps } from "@/lib/calendar/server";
import { ensureHolidays } from "@/lib/calendar/service.ts";
import { DEFAULT_TIME_ZONE, DEFAULT_WEEK, type Weekday } from "@/lib/calendar/business.ts";
import { load, SetupRequired } from "@/components/admin/ui";
import { SubmitOnce } from "@/components/admin/submit-once";
import { addClosureAction, editClosureAction, removeClosureAction, saveBusinessHoursAction, toggleClosureAction } from "../actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const range = (a: string, b: string) => (a === b ? a : `${a} to ${b}`);

/** The weekly hours and closed days, shown under the firm profile. */
export async function BusinessHoursSection() {
  await requireAdmin();
  const deps = businessDeps();
  const result = await load(async () => {
    await ensureHolidays(deps).catch(() => 0);
    const [week, closures, profile] = await Promise.all([deps.repo.getWeek(), deps.repo.listClosures(), documentDeps().repo.getProfile().catch(() => null)]);
    return { week: week ?? DEFAULT_WEEK, closures, zone: profile?.time_zone ?? DEFAULT_TIME_ZONE };
  });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <h2 style={{ marginTop: 24 }}>Business hours</h2>
      <p className="monarch-muted">When your office is open. Automations that wait &quot;business hours&quot; or &quot;business days&quot; only count this time, and appointment times use it.</p>
      {!result.ok ? <SetupRequired message={result.message} /> : (
        <>
          <form action={saveBusinessHoursAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
            <h2>Weekly hours</h2>
            <p className="monarch-muted">Times are in {result.data.zone.replace(/_/g, " ")}. Change the time zone on the firm profile.</p>
            {DAYS.map((name, d) => {
              const h = result.data.week[d as Weekday];
              return (
                <div key={d} className="is-wide" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <label style={{ minWidth: 130 }}><input type="checkbox" name={`open_${d}`} defaultChecked={!!h} /> {name}</label>
                  <input type="time" name={`from_${d}`} defaultValue={h?.open ?? "09:00"} aria-label={`${name} opens`} />
                  <span>to</span>
                  <input type="time" name={`to_${d}`} defaultValue={h?.close ?? "17:00"} aria-label={`${name} closes`} />
                </div>
              );
            })}
            <div className="is-wide"><SubmitOnce>Save hours</SubmitOnce></div>
          </form>

          <section className="monarch-panel" style={{ padding: 20, marginTop: 16 }}>
            <h2>Closed days</h2>
            <p className="monarch-muted">Federal holidays are added for you. Switch one off if you work that day, or change its dates (for example, close December 23 to 26). Add your own closures below.</p>
            <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
              {result.data.closures.filter((c) => c.end_date >= today).map((c) => (
                <li key={c.id} className="monarch-panel" style={{ padding: 12 }}>
                  <strong>{c.name}</strong> <span className="monarch-muted">{range(c.start_date, c.end_date)}{c.source === "federal" ? " · federal holiday" : ""}</span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                    <form action={toggleClosureAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <label><input type="checkbox" name="enabled" defaultChecked={c.enabled} /> Closed</label> <button className="monarch-secondary">Update</button>
                    </form>
                    <details>
                      <summary>Edit dates</summary>
                      <form action={editClosureAction} className="monarch-form">
                        <input type="hidden" name="id" value={c.id} />
                        <label>Name<input name="name" required maxLength={80} defaultValue={c.name} /></label>
                        <label>First day<input type="date" name="start" required defaultValue={c.start_date} /></label>
                        <label>Last day<input type="date" name="end" required defaultValue={c.end_date} /></label>
                        <button className="monarch-secondary">Save dates</button>
                      </form>
                    </details>
                    {c.source === "custom" && (
                      <form action={removeClosureAction}><input type="hidden" name="id" value={c.id} /><button className="monarch-secondary">Remove</button></form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <form action={addClosureAction} className="monarch-form" style={{ marginTop: 12 }}>
              <h3>Add a closure</h3>
              <label>Name<input name="name" required maxLength={80} placeholder="Office retreat" /></label>
              <label>First day<input type="date" name="start" required /></label>
              <label>Last day<input type="date" name="end" /></label>
              <div className="is-wide"><SubmitOnce>Add closure</SubmitOnce></div>
            </form>
          </section>
        </>
      )}
    </>
  );
}
