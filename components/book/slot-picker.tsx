"use client";

import { useMemo, useState, useSyncExternalStore } from "react";

type Props = { slots: string[]; officeTz: string; name?: string };

const noopSubscribe = () => () => {};
const fmtDay = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
const fmtTime = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const dayKey = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** Times shown in the visitor's own time zone (the office's until the browser is known); the zone travels with the booking. */
export function SlotPicker({ slots, officeTz, name = "starts_at" }: Props) {
  // The server renders the office's zone; the browser switches to its own once it is known.
  const browserTz = useSyncExternalStore(noopSubscribe, () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } }, () => "");
  const tz = browserTz || officeTz;
  const days = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of slots) { const k = dayKey(s, tz); map.set(k, [...(map.get(k) ?? []), s]); }
    return [...map.entries()];
  }, [slots, tz]);
  const [picked, setPicked] = useState<string | null>(null);
  if (!slots.length) return <p>There are no open times in the next two weeks. Please call the office.</p>;
  return (
    <div>
      <input type="hidden" name="time_zone" value={tz} />
      <p className="monarch-muted">Times are shown in {tz.replace(/_/g, " ")}.</p>
      {days.map(([k, list]) => (
        <fieldset key={k} style={{ border: 0, padding: 0, margin: "0 0 14px" }}>
          <legend><strong>{fmtDay(list[0], tz)}</strong></legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
            {list.map((s) => (
              <label key={s} className={picked === s ? "monarch-primary" : "monarch-secondary"} style={{ cursor: "pointer", minWidth: 88, textAlign: "center", padding: "10px 12px" }}>
                <input type="radio" name={name} value={s} required style={{ position: "absolute", opacity: 0, pointerEvents: "none" }} onChange={() => setPicked(s)} />
                {fmtTime(s, tz)}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
