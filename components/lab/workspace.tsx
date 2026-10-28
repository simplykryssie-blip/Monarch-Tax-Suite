"use client";

import { useEffect, useRef, useState } from "react";
import { checkAction, saveDraftAction, submitAction } from "@/app/lab/actions";
import { fmt, LINE_INFO, normalizeReturn, type LineKey, type TaxReturn } from "@/lib/lab/engine";
import type { Fact, SourceDocs } from "@/lib/lab/types";
import { ClientFile } from "./client-file";
import { IntakeSheet, type Intake } from "./intake-sheet";
import { Software } from "./software";

// A student's practice page for one scenario: client file, intake sheet, the practice software, and Check & submit.
// Work saves to the server automatically; checks and submissions run on the server against the hidden answer key.

export type WorkSummary = {
  status: "draft" | "submitted" | "graded";
  submittedAt: string | null;
  correct: number | null;
  total: number | null;
  grade: "pass" | "revise" | null;
  score: string | null;
  feedback: string | null;
  checksRun: number;
};

type Props = {
  scenarioId: string;
  title: string;
  level: string;
  interview: boolean;
  narrative: string | null;
  facts: Fact[] | null;
  documents: SourceDocs;
  checkCount: number;
  initialRet: unknown;
  initialIntake: Intake;
  work: WorkSummary | null;
  canSubmit: boolean;
};

type CheckResult = { results: { k: LineKey; value: number; pass: boolean }[]; correct: number; total: number; rejects: number };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

export function Workspace(p: Props) {
  const [tab, setTab] = useState<"file" | "intake" | "sw" | "check">("file");
  const [ret, setRet] = useState<TaxReturn>(() => normalizeReturn(p.initialRet));
  const [intake, setIntake] = useState<Intake>(p.initialIntake);
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "error"; msg?: string }>({ state: "idle" });
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checks, setChecks] = useState(p.work?.checksRun ?? 0);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "good" | "bad"; text: string } | null>(null);
  const [work, setWork] = useState<WorkSummary | null>(p.work);
  const [note, setNote] = useState("");
  const first = useRef(true);

  // Autosave a moment after the last change.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setSave({ state: "saving" });
    const t = setTimeout(async () => {
      const r = await saveDraftAction(p.scenarioId, ret, intake);
      setSave("error" in r ? { state: "error", msg: r.error } : { state: "saved" });
    }, 1200);
    return () => clearTimeout(t);
  }, [ret, intake, p.scenarioId]);

  async function runCheck() {
    setBusy(true); setFlash(null);
    const r = await checkAction(p.scenarioId, ret, intake);
    setBusy(false);
    if ("error" in r) { setFlash({ kind: "bad", text: r.error }); return; }
    setCheck(r); setChecks((n) => n + 1);
  }
  async function submit() {
    setBusy(true); setFlash(null);
    const r = await submitAction(p.scenarioId, ret, intake, note);
    setBusy(false);
    if ("error" in r) { setFlash({ kind: "bad", text: r.error }); return; }
    setWork({ status: "submitted", submittedAt: r.submittedAt ?? null, correct: r.correct ?? null, total: r.total ?? null, grade: null, score: null, feedback: null, checksRun: checks });
    setFlash({ kind: "good", text: "Submitted. Your instructor will see it in their review queue." });
  }

  const saveLabel = save.state === "saving" ? "Saving…" : save.state === "saved" ? "Saved" : save.state === "error" ? `Not saved: ${save.msg}` : "Work saves automatically";
  const tabs: [typeof tab, string][] = [["file", "Client file"], ["intake", "Intake sheet"], ["sw", "Software"], ["check", "Check & submit"]];

  return (
    <div className="lab-stack">
      <div className="lab-row lab-between">
        <div className="lab-tabs" role="tablist" style={{ flex: 1 }}>
          {tabs.map(([id, label]) => <button key={id} type="button" role="tab" className="lab-tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
        </div>
        <span className={`lab-small ${save.state === "error" ? "lab-no" : "lab-muted"}`} aria-live="polite">{saveLabel}</span>
      </div>
      {flash ? <div className={`lab-notice ${flash.kind}`}>{flash.text}</div> : null}

      {tab === "file" ? (
        <div className="lab-stack">
          <div className="lab-card lab-stack">
            <div className="lab-row lab-between"><h2>Intake packet</h2><a className="lab-btn" href={`/lab/s/${p.scenarioId}/packet`} target="_blank" rel="noopener">Download packet (PDF)</a></div>
            <p className="lab-muted lab-small">Open the PDF beside this page or print it, and work from it like a real intake. It includes a blank intake sheet.</p>
          </div>
          <ClientFile narrative={p.narrative} facts={p.facts} documents={p.documents} interview={p.interview} />
        </div>
      ) : null}
      {tab === "intake" ? <IntakeSheet value={intake} onChange={setIntake} interview={p.interview} /> : null}
      {tab === "sw" ? <Software ret={ret} onChange={setRet} mode="student" printHref={`/lab/s/${p.scenarioId}/return`} /> : null}
      {tab === "check" ? (
        <div className="lab-stack">
          <div className="lab-card lab-stack">
            <h2>Check my return</h2>
            <p className="lab-muted">Compares {p.checkCount} lines with the answer key. You see which lines match, not the correct amounts. Checks so far: <span className="lab-num">{checks}</span>.</p>
            <div className="lab-row"><button type="button" className="lab-btn primary" disabled={busy} onClick={runCheck}>{busy ? "Checking…" : "Check my return"}</button></div>
            {check ? (
              <>
                <div className={`lab-notice ${check.correct === check.total ? "good" : "warn"}`}>
                  <b>{check.correct} of {check.total} lines match.</b> {check.correct === check.total ? (p.canSubmit ? "Nice work. Submit it for review." : "Nice work.") : "Go back to the software, fix your entries, then check again."}
                  {check.rejects ? ` E-file check: ${check.rejects} reject${check.rejects > 1 ? "s" : ""} to fix.` : " E-file check: no rejects."}
                </div>
                <div>
                  {check.results.map((r) => (
                    <div className="result" key={r.k}>
                      <span className="ln">{LINE_INFO[r.k].n}</span><span>{LINE_INFO[r.k].label}</span><span className="v">{fmt(r.value)}</span>
                      {r.pass ? <span className="lab-ok" aria-label="Matches">✓</span> : <span className="lab-no" aria-label="Does not match">✗</span>}
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
          {p.canSubmit ? (
            <div className="lab-card lab-stack">
              <h2>Submit for instructor review</h2>
              <p className="lab-muted lab-small">Your return and intake sheet go to your instructor. You can resubmit after changes.</p>
              {work && work.status !== "draft" ? (
                <div className="lab-row">
                  {work.status === "graded" ? (work.grade === "revise" ? <span className="lab-pill warn">Needs revision</span> : <span className="lab-pill good">Passed</span>) : <span className="lab-pill">Waiting for review</span>}
                  <span className="lab-muted lab-small">Submitted {when(work.submittedAt)} · {work.correct} of {work.total} lines matched</span>
                </div>
              ) : null}
              {work?.status === "graded" ? <div className="lab-notice"><b>Instructor feedback{work.score ? ` · Score ${work.score}` : ""}</b><br /><span style={{ whiteSpace: "pre-line" }}>{work.feedback || "No written feedback."}</span></div> : null}
              <label className="f">Note to your instructor <span className="hint">(optional)</span><textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="Questions, or anything you were unsure about" /></label>
              <div className="lab-row"><button type="button" className="lab-btn primary" disabled={busy} onClick={submit}>{work && work.status !== "draft" ? "Resubmit my return" : "Submit my return"}</button></div>
            </div>
          ) : (
            <div className="lab-card"><p className="lab-muted">Your license is for self-study: use Check my return as often as you like. Instructor review is included with instructor-led classes.</p></div>
          )}
        </div>
      ) : null}
    </div>
  );
}
