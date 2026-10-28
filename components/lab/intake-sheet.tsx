"use client";

import { INTAKE } from "@/lib/lab/intake";

export type Intake = Record<string, string | boolean>;

/** The intake and interview sheet. Controlled: the workspace keeps the values and saves them with the return. */
export function IntakeSheet({ value, onChange, interview }: { value: Intake; onChange: (v: Intake) => void; interview: boolean }) {
  const set = (k: string, v: string | boolean) => onChange({ ...value, [k]: v });
  return (
    <div className="lab-stack">
      <div className="lab-card lab-stack">
        <h2>Intake & interview sheet</h2>
        <p className="lab-muted">{interview ? "Record what the client tells you. Your instructor sees this sheet when you submit." : "Practice filling this out from the client notes."} It saves automatically.</p>
      </div>
      {INTAKE.map((s) => (
        <div className="lab-card lab-stack" key={s.sec}>
          <h3>{s.sec}</h3>
          {s.checks ? (
            <div className="ikgrid">
              {s.checks.map(([k, label]) => (
                <label className="check" key={k}><input type="checkbox" checked={value[k] === true} onChange={(e) => set(k, e.target.checked)} />{label}</label>
              ))}
            </div>
          ) : null}
          {(s.fields ?? []).map(([k, label, kind]) => (
            <label className="f" key={k}>
              {label}
              {kind === "line" ? (
                <input type="text" value={String(value[k] ?? "")} onChange={(e) => set(k, e.target.value)} maxLength={400} />
              ) : (
                <textarea rows={3} value={String(value[k] ?? "")} onChange={(e) => set(k, e.target.value)} maxLength={4000} />
              )}
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}
