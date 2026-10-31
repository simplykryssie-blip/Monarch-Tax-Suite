"use client";

import { useEffect, useState } from "react";
import { EVENTS } from "@/lib/automation/events.ts";
import { countSteps, MAX_BRANCH_DEPTH, MAX_STEPS } from "@/lib/automation/steps.ts";
import type { Step } from "@/lib/automation/types.ts";
import { LEAD_STATUSES } from "@/lib/leads/types.ts";

// The workflow's steps: actions, waits and If / else branches, each branch holding its own steps. The tree travels to the
// server as JSON in one hidden field and is checked there again; nothing in this file is trusted.

export type BuilderCatalog = {
  templates: { id: string; name: string; active: boolean }[];
  documents: { id: string; name: string; file_type: string }[];
  senders: { id: string; label: string }[];
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[];
};
type Draft = { type: string; [k: string]: unknown };
type Cond = { field: string; op: string; value: string };

const KINDS: [string, string][] = [
  ["send_email", "Send an email"], ["send_text", "Send a text"], ["send_document", "Send a document"], ["request_signature", "Request a signature"],
  ["create_task", "Create a task"], ["add_tag", "Add a tag"], ["remove_tag", "Remove a tag"], ["update_contact", "Change the lead's status"],
  ["move_stage", "Move to a stage"], ["wait", "Wait"], ["branch", "If / else"], ["record_note", "Record a note"],
];
const kindName = (type: string) => KINDS.find(([k]) => k === type)?.[1] ?? type;

const blank = (kind: string): Draft => {
  switch (kind) {
    case "send_email": return { type: kind, template_id: "", to: "customer", include_setup_link: false };
    case "send_document": return { type: kind, document_id: "", sender_id: "", message: "", link_days: 14 };
    case "request_signature": return { type: kind, document_id: "", sender_id: "", message: "", link_days: 14, reminder_days: "" };
    case "record_note": return { type: kind, note: "" };
    case "move_stage": return { type: kind, pipeline_id: "", stage_id: "" };
    case "wait": return { type: kind, amount: 1, unit: "days", mode: "business" };
    case "branch": return { type: kind, conditions: [{ field: "contact.tags", op: "contains", value: "" }], then: [], else: [] };
    case "create_task": return { type: kind, title: "", due_days: "" };
    case "add_tag": case "remove_tag": return { type: kind, tag: "" };
    case "update_contact": return { type: kind, field: "lead_status", value: "interested" };
    default: return { type: kind, body: "" };
  }
};

/** The trigger chosen in the form above, followed as it changes. */
function useTrigger(initial: string) {
  const [trigger, setTrigger] = useState(initial);
  useEffect(() => {
    const el = document.querySelector<HTMLSelectElement>('select[name="trigger_event"]');
    if (!el) return;
    const on = () => setTrigger(el.value);
    el.addEventListener("change", on);
    return () => el.removeEventListener("change", on);
  }, []);
  return trigger;
}

/** Days before or after the date, for the date-based trigger only. */
export function OffsetField({ initialTrigger, initial }: { initialTrigger: string; initial: number | null }) {
  const trigger = useTrigger(initialTrigger);
  if (!trigger.startsWith("date.")) return null;
  return (
    <label>Days from the date (negative = before, positive = after)
      <input name="offset_days" type="number" min={-365} max={365} defaultValue={initial ?? -7} required />
    </label>
  );
}

const field = { width: "100%" } as const;

function Conditions({ conds, onChange, eventFields }: { conds: Cond[]; onChange: (c: Cond[]) => void; eventFields: string[] }) {
  const set = (i: number, patch: Partial<Cond>) => onChange(conds.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {conds.map((c, i) => {
        const tag = c.field === "contact.tags";
        const fixed = c.field === "contact.lead_status" ? Object.keys(LEAD_STATUSES) : c.field === "contact.is_lead" || c.field === "contact.is_client" ? ["yes", "no"] : null;
        return (
          <div key={i} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <select value={c.field} aria-label="What to check" onChange={(e) => set(i, { field: e.target.value, op: e.target.value === "contact.tags" ? "contains" : "eq", value: "" })}>
              <option value="contact.tags">Their tags</option>
              <option value="contact.lead_status">Lead status</option>
              <option value="contact.is_lead">Is a lead</option>
              <option value="contact.is_client">Is a client</option>
              {eventFields.map((f) => <option key={f} value={f}>Event: {f}</option>)}
            </select>
            <select value={c.op} aria-label="How" onChange={(e) => set(i, { op: e.target.value })}>
              {tag ? <><option value="contains">has the tag</option><option value="not_contains">doesn&apos;t have the tag</option></> : <><option value="eq">is</option><option value="neq">is not</option><option value="in">is one of</option></>}
            </select>
            {fixed && c.op !== "in" ? (
              <select value={c.value} aria-label="Value" onChange={(e) => set(i, { value: e.target.value })}><option value="">Choose…</option>{fixed.map((v) => <option key={v} value={v}>{v}</option>)}</select>
            ) : (
              <input value={c.value} aria-label="Value" placeholder={tag ? "tag" : "value"} maxLength={120} onChange={(e) => set(i, { value: e.target.value })} />
            )}
            {conds.length > 1 && <button type="button" className="monarch-secondary" onClick={() => onChange(conds.filter((_, j) => j !== i))} aria-label="Remove condition">×</button>}
          </div>
        );
      })}
      {conds.length < 3 && <button type="button" className="monarch-secondary" style={{ justifySelf: "start" }} onClick={() => onChange([...conds, { field: "contact.tags", op: "contains", value: "" }])}>+ Another condition (all must be true)</button>}
    </div>
  );
}

function Editor({ step, onChange, cat, depth, eventFields, budget }: { step: Draft; onChange: (s: Draft) => void; cat: BuilderCatalog; depth: number; eventFields: string[]; budget: number }) {
  const set = (patch: Record<string, unknown>) => onChange({ ...step, ...patch });
  const text = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label>{label}<input style={field} value={String(step[k] ?? "")} onChange={(e) => set({ [k]: e.target.value })} {...props} /></label>
  );
  switch (step.type) {
    case "send_email":
      return (
        <div className="monarch-form">
          <label>Template<select value={String(step.template_id ?? "")} onChange={(e) => set({ template_id: e.target.value })}><option value="">Choose…</option>{cat.templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.active ? "" : " (off)"}</option>)}</select></label>
          <label>To<select value={String(step.to ?? "customer")} onChange={(e) => set({ to: e.target.value })}><option value="customer">the person</option><option value="support">our support address</option></select></label>
          <label className="is-wide"><input type="checkbox" checked={step.include_setup_link === true} onChange={(e) => set({ include_setup_link: e.target.checked })} /> include a setup link (license events only)</label>
        </div>
      );
    case "send_document": case "request_signature":
      return (
        <div className="monarch-form">
          <label>Document<select value={String(step.document_id ?? "")} onChange={(e) => set({ document_id: e.target.value })}><option value="">Choose…</option>{cat.documents.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.file_type.toUpperCase()})</option>)}</select></label>
          <label>From<select value={String(step.sender_id ?? "")} onChange={(e) => set({ sender_id: e.target.value })}><option value="">default address</option>{cat.senders.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          {text("message", "Message to include", { maxLength: 1000 })}
          {text("link_days", "Link lasts (days)", { type: "number", min: 1, max: 60 })}
          {step.type === "request_signature" && text("reminder_days", "Remind every (days, blank = off)", { type: "number", min: 1, max: 30 })}
        </div>
      );
    case "move_stage": {
      const chosen = cat.pipelines.find((p) => p.id === step.pipeline_id);
      return (
        <div className="monarch-form">
          <label>Pipeline<select value={String(step.pipeline_id ?? "")} onChange={(e) => set({ pipeline_id: e.target.value, stage_id: "" })}><option value="">Choose…</option>{cat.pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Move to<select value={String(step.stage_id ?? "")} onChange={(e) => set({ stage_id: e.target.value })} disabled={!chosen}><option value="">Choose…</option>{(chosen?.stages ?? []).map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}</select></label>
        </div>
      );
    }
    case "record_note": return <div className="monarch-form">{text("note", "Note", { maxLength: 300 })}</div>;
    case "create_task": return <div className="monarch-form">{text("title", "Task", { maxLength: 200, placeholder: "Call about their return" })}{text("due_days", "Due in (days, blank = no date)", { type: "number", min: 0, max: 365 })}</div>;
    case "add_tag": case "remove_tag": return <div className="monarch-form">{text("tag", "Tag", { maxLength: 40, placeholder: "warm lead" })}<small className="monarch-muted is-wide">Applies to the person&apos;s lead and client records.</small></div>;
    case "update_contact":
      return <div className="monarch-form"><label>Set the lead&apos;s status to<select value={String(step.value ?? "interested")} onChange={(e) => set({ value: e.target.value })}>{Object.entries(LEAD_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>;
    case "send_text":
      return (
        <div className="monarch-form">
          <label className="is-wide">Message<textarea rows={3} maxLength={320} value={String(step.body ?? "")} onChange={(e) => set({ body: e.target.value })} /></label>
          <small className="monarch-muted is-wide">{String(step.body ?? "").length}/320. Sent from your own number and credits, only to people who agreed to texts (for example, ticked the box when booking). Everyone else is skipped.</small>
        </div>
      );
    case "wait":
      return (
        <div className="monarch-form">
          <label>Wait for<input type="number" min={1} max={step.unit === "days" ? 365 : step.unit === "hours" ? 720 : 1440} value={String(step.amount ?? 1)} onChange={(e) => set({ amount: e.target.value === "" ? "" : Number(e.target.value) })} /></label>
          <label>Unit<select value={String(step.unit)} onChange={(e) => set({ unit: e.target.value })}><option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option></select></label>
          <label>Counting<select value={String(step.mode)} onChange={(e) => set({ mode: e.target.value })}><option value="business">business time (your open hours, not holidays)</option><option value="calendar">calendar time (every hour and day)</option></select></label>
        </div>
      );
    case "branch": {
      const b = step as unknown as { conditions: Cond[]; then: Draft[]; else: Draft[] };
      return (
        <div style={{ display: "grid", gap: 10 }}>
          <div><b>If</b> <small className="monarch-muted">(all of these are true)</small><Conditions conds={b.conditions} eventFields={eventFields} onChange={(conditions) => set({ conditions })} /></div>
          <div style={{ borderLeft: "3px solid #059669", paddingLeft: 10 }}><b>Yes: then</b><StepList steps={b.then} onChange={(then) => set({ then })} cat={cat} depth={depth + 1} eventFields={eventFields} budget={budget} /></div>
          <div style={{ borderLeft: "3px solid #d97706", paddingLeft: 10 }}><b>No: otherwise</b><StepList steps={b.else} onChange={(els) => set({ else: els })} cat={cat} depth={depth + 1} eventFields={eventFields} budget={budget} /></div>
        </div>
      );
    }
    default: return null;
  }
}

function StepList({ steps, onChange, cat, depth, eventFields, budget }: { steps: Draft[]; onChange: (s: Draft[]) => void; cat: BuilderCatalog; depth: number; eventFields: string[]; budget: number }) {
  const move = (i: number, d: number) => { const next = steps.slice(); const [s] = next.splice(i, 1); next.splice(i + d, 0, s); onChange(next); };
  const canBranch = depth < MAX_BRANCH_DEPTH;
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
      {steps.map((s, i) => (
        <div key={i} className="monarch-panel" style={{ padding: 10 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
            <b>{i + 1}.</b>
            <select value={s.type} aria-label="What this step does" onChange={(e) => onChange(steps.map((x, j) => (j === i ? blank(e.target.value) : x)))}>
              {KINDS.filter(([k]) => k !== "branch" || canBranch || s.type === "branch").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <span style={{ flex: 1 }} />
            <button type="button" className="monarch-secondary" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
            <button type="button" className="monarch-secondary" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
            <button type="button" className="monarch-secondary" onClick={() => onChange(steps.filter((_, j) => j !== i))} aria-label={`Remove ${kindName(s.type)}`}>Remove</button>
          </div>
          <Editor step={s} onChange={(next) => onChange(steps.map((x, j) => (j === i ? next : x)))} cat={cat} depth={depth} eventFields={eventFields} budget={budget} />
        </div>
      ))}
      <select value="" aria-label="Add a step" disabled={budget <= 0} onChange={(e) => e.target.value && onChange([...steps, blank(e.target.value)])}>
        <option value="">{budget <= 0 ? `Limit of ${MAX_STEPS} steps reached` : "+ Add a step…"}</option>
        {KINDS.filter(([k]) => k !== "branch" || canBranch).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </div>
  );
}

export function StepBuilder({ initial, catalog, initialTrigger }: { initial: Step[]; catalog: BuilderCatalog; initialTrigger: string }) {
  const [steps, setSteps] = useState<Draft[]>(initial as unknown as Draft[]);
  const trigger = useTrigger(initialTrigger);
  const eventFields = Object.keys(EVENTS[trigger]?.fields ?? {});
  const used = countSteps(steps as unknown as Step[]);
  return (
    <fieldset className="is-wide">
      <legend>Steps, in order</legend>
      <input type="hidden" name="steps_json" value={JSON.stringify(steps)} />
      <p className="monarch-muted" style={{ margin: "0 0 4px" }}>{used} of {MAX_STEPS} steps used. A Wait holds the run, then it carries on by itself. If / else can go {MAX_BRANCH_DEPTH} levels deep.</p>
      <StepList steps={steps} onChange={setSteps} cat={catalog} depth={0} eventFields={eventFields} budget={MAX_STEPS - used} />
    </fieldset>
  );
}
