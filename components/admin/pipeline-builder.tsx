"use client";

import { useState } from "react";
import { SubmitOnce } from "./submit-once";
import { MAX_STAGES, MIN_STAGES, STAGE_COLORS } from "@/lib/pipelines/service.ts";
import type { Stage } from "@/lib/pipelines/types.ts";

/** A visual pipeline: stages in a row you can drag (or nudge with the arrows), rename, color and remove. */
export function PipelineBuilder({ id, name, stages: initial, action, canSave = true }: { id: string; name: string; stages: Stage[]; action: (form: FormData) => Promise<void>; canSave?: boolean }) {
  const [stages, setStages] = useState<Stage[]>(initial);
  const [title, setTitle] = useState(name);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= stages.length || from === to) return;
    const next = stages.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setStages(next);
  };
  const patch = (i: number, p: Partial<Stage>) => setStages(stages.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const add = () => {
    if (stages.length >= MAX_STAGES) return;
    const n = stages.length + 1;
    setStages([...stages, { id: `stage-${Date.now().toString(36)}`, name: `Stage ${n}`, color: STAGE_COLORS[n % STAGE_COLORS.length], done: false }]);
  };

  return (
    <form action={action} className="monarch-panel" style={{ padding: 20 }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="stages" value={JSON.stringify(stages)} />
      <label className="pb-name">Pipeline name<input name="name" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required /></label>
      <p className="monarch-muted">Drag a stage to reorder it, or use the arrows. Work moves left to right. Mark the stage where work is finished.</p>
      <ol className="pb-row" aria-label="Stages">
        {stages.map((s, i) => (
          <li
            key={s.id}
            className={"pb-stage" + (over === i && drag !== null && drag !== i ? " is-over" : "") + (drag === i ? " is-drag" : "")}
            style={{ borderTopColor: s.color }}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => { e.preventDefault(); setOver(i); }}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            onDrop={() => { if (drag !== null) move(drag, i); setDrag(null); setOver(null); }}
          >
            <div className="pb-top">
              <span className="pb-num" aria-hidden="true">{i + 1}</span>
              <span className="pb-grip" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
              <button type="button" className="pb-icon" aria-label={`Move ${s.name} left`} disabled={i === 0} onClick={() => move(i, i - 1)}>◀</button>
              <button type="button" className="pb-icon" aria-label={`Move ${s.name} right`} disabled={i === stages.length - 1} onClick={() => move(i, i + 1)}>▶</button>
              <button type="button" className="pb-icon is-danger" aria-label={`Remove ${s.name}`} disabled={stages.length <= MIN_STAGES} onClick={() => setStages(stages.filter((_, j) => j !== i))}>✕</button>
            </div>
            <input aria-label={`Name of stage ${i + 1}`} value={s.name} maxLength={40} onChange={(e) => patch(i, { name: e.target.value })} />
            <div className="pb-colors" role="group" aria-label="Color">
              {STAGE_COLORS.map((c) => <button key={c} type="button" className={"pb-swatch" + (s.color === c ? " is-on" : "")} style={{ background: c }} aria-label={`Color ${c}`} aria-pressed={s.color === c} onClick={() => patch(i, { color: c })} />)}
            </div>
            <label className="pb-done"><input type="checkbox" checked={s.done} onChange={(e) => patch(i, { done: e.target.checked })} /> Work is finished here</label>
          </li>
        ))}
        {stages.length < MAX_STAGES && <li className="pb-add"><button type="button" className="monarch-secondary" onClick={add}>+ Add stage</button></li>}
      </ol>
      <div className="pb-flow" aria-hidden="true">{stages.map((s, i) => <span key={s.id}><i style={{ background: s.color }} />{s.name || "…"}{i < stages.length - 1 && " →"} </span>)}</div>
      <div style={{ marginTop: 12 }}><SubmitOnce className="monarch-primary" busy="Saving…" disabled={!canSave}>Save pipeline</SubmitOnce></div>
    </form>
  );
}
