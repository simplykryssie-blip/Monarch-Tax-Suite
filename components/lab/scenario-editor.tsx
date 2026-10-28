"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveScenarioAction } from "@/app/lab/actions";
import { compute, fmt, LINES, normalizeReturn, type TaxReturn } from "@/lib/lab/engine";
import { DOC_OPTIONS, LAB_LEVELS, type DocOptions } from "@/lib/lab/types";
import { Software } from "./software";

// Writes a scenario: the client story, which practice documents students get, the answer key (prepared in the same
// software students use) and the lines students must match. Line values are recomputed on the server when saving.

export type EditorInitial = {
  id: string | null;
  scope: "library" | "license";
  status: "draft" | "published";
  title: string;
  level: string;
  summary: string;
  narrative: string;
  factsText: string;
  intakeMode: "notes" | "interview";
  docOptions: DocOptions;
  ret: unknown;
  checks: string[];
  overrides: Record<string, string>;
};

export function ScenarioEditor({ initial }: { initial: EditorInitial }) {
  const router = useRouter();
  const [tab, setTab] = useState<"details" | "key" | "lines">("details");
  const [f, setF] = useState({ ...initial });
  const [ret, setRet] = useState<TaxReturn>(() => normalizeReturn(initial.ret));
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "good" | "bad"; text: string } | null>(null);
  const lines = useMemo(() => compute(ret), [ret]);
  const upd = <K extends keyof EditorInitial>(k: K, v: EditorInitial[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save(status: "draft" | "published") {
    setBusy(true); setFlash(null);
    const r = await saveScenarioAction({ ...f, status, ret });
    setBusy(false);
    if ("error" in r) { setFlash({ kind: "bad", text: r.error }); return; }
    setF((x) => ({ ...x, id: r.id, status }));
    setFlash({ kind: "good", text: status === "published" ? "Saved and published. Students can open it now." : "Draft saved. Students can't see it until you publish." });
    if (!f.id) router.replace(`/lab/scenarios/${r.id}`);
    else router.refresh();
  }

  const tabs: [typeof tab, string][] = [["details", "Details & documents"], ["key", "Prepare answer key"], ["lines", "Lines to check"]];
  return (
    <div className="lab-stack">
      <div className="lab-tabs" role="tablist">
        {tabs.map(([id, label]) => <button key={id} type="button" role="tab" className="lab-tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {flash ? <div className={`lab-notice ${flash.kind}`}>{flash.text}</div> : null}

      {tab === "details" ? (
        <>
          <div className="lab-card lab-stack">
            <label className="f">Scenario title<input type="text" value={f.title} maxLength={160} onChange={(e) => upd("title", e.target.value)} placeholder="Single parent with a side business" /></label>
            <div className="lab-grid2">
              <label className="f">Level<select value={f.level} onChange={(e) => upd("level", e.target.value)}>{LAB_LEVELS.map((l) => <option key={l}>{l}</option>)}</select></label>
              <label className="f">One-line summary<input type="text" value={f.summary} maxLength={300} onChange={(e) => upd("summary", e.target.value)} placeholder="HOH, W-2 + Schedule C, one child" /></label>
            </div>
          </div>
          <div className="lab-card lab-stack">
            <h2>Intake</h2>
            <div className="seg">
              <label><input type="radio" name="imode" checked={f.intakeMode === "notes"} onChange={() => upd("intakeMode", "notes")} /><span><b>Give students the interview notes</b><small>Students read the client story and facts, then prepare the return.</small></span></label>
              <label><input type="radio" name="imode" checked={f.intakeMode === "interview"} onChange={() => { upd("intakeMode", "interview"); upd("docOptions", { ...f.docOptions, household: false }); }} /><span><b>Students interview the client</b><small>The story stays hidden. You play the client; students fill out the intake sheet themselves.</small></span></label>
            </div>
            <label className="f">Client story <span className="hint">{f.intakeMode === "notes" ? "(shown to students; leave a blank line between paragraphs)" : "(hidden from students; your script for playing the client)"}</span>
              <textarea rows={8} value={f.narrative} maxLength={20000} onChange={(e) => upd("narrative", e.target.value)} />
            </label>
            <label className="f">Key facts <span className="hint">(one per line, “Label: value”)</span>
              <textarea rows={5} value={f.factsText} onChange={(e) => upd("factsText", e.target.value)} placeholder={"Marital status: Never married\nLived with child: All year"} />
            </label>
          </div>
          <div className="lab-card lab-stack">
            <h2>Documents for students</h2>
            <p className="lab-muted lab-small">Practice forms are built from what you enter in the answer key. Use made-up SSNs and EINs. Turn off anything students should get by interviewing instead.</p>
            <div className="ikgrid">
              {DOC_OPTIONS.map(([k, label]) => (
                <label className="check" key={k}><input type="checkbox" checked={Boolean(f.docOptions[k])} onChange={(e) => upd("docOptions", { ...f.docOptions, [k]: e.target.checked })} />{label}</label>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {tab === "key" ? (
        <>
          <div className="lab-notice">Prepare the correct return here, exactly as a student should. The numbers it produces become the answer key.</div>
          <Software ret={ret} onChange={setRet} mode="key" />
        </>
      ) : null}

      {tab === "lines" ? (
        <div className="lab-card lab-stack">
          <h2>Lines students must match</h2>
          <p className="lab-muted lab-small">A line passes when the student’s software produces the same whole-dollar amount. Override only when you need a different figure; the student’s entries must still produce it.</p>
          <div>
            {LINES.map(([k, ln, label]) => {
              const on = f.checks.includes(k);
              return (
                <div className="keyline" key={k}>
                  <input type="checkbox" aria-label={`Check line ${ln}`} checked={on} style={{ width: 18, height: 18, accentColor: "var(--l-gold)" }}
                    onChange={(e) => upd("checks", e.target.checked ? [...f.checks, k] : f.checks.filter((x) => x !== k))} />
                  <span className="ln">{ln}</span>
                  <span>{label}<span className="eng">Software: {fmt(lines.lines[k])}</span></span>
                  <input type="text" inputMode="decimal" className="money" aria-label={`Override line ${ln}`} placeholder={String(Math.round(lines.lines[k]))}
                    value={f.overrides[k] ?? ""} onChange={(e) => upd("overrides", { ...f.overrides, [k]: e.target.value })} />
                </div>
              );
            })}
          </div>
          {lines.notes.map((x) => <div key={x} className="lab-notice warn">{x}</div>)}
        </div>
      ) : null}

      <div className="savebar">
        <div className="lab-row lab-between" style={{ paddingBlock: 10 }}>
          <span className="lab-small lab-muted">{f.status === "published" ? "Published" : "Draft"}{f.scope === "library" ? " · Monarch library" : " · Your class"}</span>
          <div className="lab-row">
            <button type="button" className="lab-btn" disabled={busy} onClick={() => save("draft")}>Save draft</button>
            <button type="button" className="lab-btn primary" disabled={busy} onClick={() => save("published")}>{busy ? "Saving…" : "Save & publish"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
