"use client";

import { useMemo, useState, useSyncExternalStore } from "react";

type Props = { slots: string[]; officeTz: string; name?: string; /** Marks the picker and says what to do, after a try without a time. */ problem?: string };

const noopSubscribe = () => () => {};
const dayKey = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const fmtTime = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const longDay = (key: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(new Date(`${key}T12:00:00Z`));
const monthName = (y: number, m: number) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m, 1)));

/**
 * A month calendar to pick a day from (days with open times are enabled), then that day's times. Times are shown in the
 * visitor's own time zone (the office's until the browser is known); the zone travels with the booking.
 */
export function MonthPicker({ slots, officeTz, name = "starts_at", problem }: Props) {
  const browserTz = useSyncExternalStore(noopSubscribe, () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } }, () => "");
  const tz = browserTz || officeTz;
  const byDay = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of slots) { const k = dayKey(s, tz); map.set(k, [...(map.get(k) ?? []), s]); }
    return map;
  }, [slots, tz]);
  const days = useMemo(() => [...byDay.keys()].sort(), [byDay]);
  const first = days[0] ?? dayKey(new Date().toISOString(), tz);
  const last = days[days.length - 1] ?? first;
  const [cursor, setCursor] = useState<{ y: number; m: number } | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  if (!slots.length) return <p>There are no open times right now. Please call the office.</p>;

  const view = cursor ?? { y: Number(first.slice(0, 4)), m: Number(first.slice(5, 7)) - 1 };
  const firstOfMonth = new Date(Date.UTC(view.y, view.m, 1));
  const lead = firstOfMonth.getUTCDay();
  const count = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const keyOf = (d: number) => `${view.y}-${String(view.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const canPrev = `${view.y}-${String(view.m + 1).padStart(2, "0")}` > first.slice(0, 7);
  const canNext = `${view.y}-${String(view.m + 1).padStart(2, "0")}` < last.slice(0, 7);
  const shift = (n: number) => setCursor({ y: view.y + Math.floor((view.m + n) / 12), m: (((view.m + n) % 12) + 12) % 12 });
  const times = day ? byDay.get(day) ?? [] : [];

  return (
    <div className={"bk-picker" + (problem ? " has-problem" : "")}>
      <input type="hidden" name="time_zone" value={tz} />
      <input name="_pick" required value={picked ?? ""} readOnly tabIndex={-1} aria-hidden="true" className="bk-guard" />
      <div className="bk-month">
        <div className="bk-head">
          <button type="button" onClick={() => shift(-1)} disabled={!canPrev} aria-label="Earlier month">←</button>
          <b>{monthName(view.y, view.m)}</b>
          <button type="button" onClick={() => shift(1)} disabled={!canNext} aria-label="Later month">→</button>
        </div>
        <div className="bk-grid" role="grid">
          {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => <span key={i} className="bk-dow" aria-hidden="true">{w}</span>)}
          {Array.from({ length: lead }, (_, i) => <span key={`e${i}`} />)}
          {Array.from({ length: count }, (_, i) => {
            const key = keyOf(i + 1);
            const open = byDay.has(key);
            return (
              <button key={key} type="button" disabled={!open} className={"bk-day" + (open ? " is-open" : "") + (day === key ? " is-on" : "")} aria-label={`${longDay(key)}${open ? "" : ", no times"}`} aria-pressed={day === key} onClick={() => { setDay(key); setPicked(null); }}>{i + 1}</button>
            );
          })}
        </div>
        <p className="monarch-muted bk-tz">Times are shown in {tz.replace(/_/g, " ")}.</p>
        {problem && <p className="bk-problem" role="alert">{problem}</p>}
      </div>
      <div className="bk-times">
        {!day ? <p className="monarch-muted">Choose a day to see its times.</p> : (
          <>
            <b>{longDay(day)}</b>
            <div className="bk-slots">
              {times.map((s) => (
                <label key={s} className={"bk-slot" + (picked === s ? " is-on" : "")}>
                  <input type="radio" name={name} value={s} required checked={picked === s} onChange={() => setPicked(s)} />
                  {fmtTime(s, tz)}
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
