"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { publishFormAction, saveDraftAction } from "@/app/(admin)/forms/actions";
import {
  CONDITION_OPS, DISPLAY_TYPES, FIELD_LABELS, FIELD_TYPES, FILE_KINDS, IDENTIFIER_FORMATS, LIMITS, MAX_FILES_PER_FIELD, OP_LABELS, checkDefinition, keyFromLabel, newField, newId,
  type Condition, type Field, type FieldType, type FormDefinition, type Page, type Section, type ShowRule, type SkipRule,
} from "@/lib/forms/definition";

// The drag-and-drop form builder. Drag a question type onto a section, or drag questions to reorder them and move
// them between sections. Every question, section and page also has Move buttons, so building works on a touchscreen
// and from the keyboard. The draft autosaves; publishing freezes it as a new version.

type Sel = { kind: "field" | "section" | "page"; id: string } | null;
type Props = { formId: string; initial: FormDefinition; savedAt: string | null; canPublish: boolean; publishedVersion: number | null; publicUrl: string | null };

const clone = <T,>(v: T): T => structuredClone(v);
const fieldsOf = (d: FormDefinition) => d.pages.flatMap((p) => p.sections.flatMap((s) => s.fields));

function locate(d: FormDefinition, fieldId: string) {
  for (const [pi, p] of d.pages.entries()) for (const [si, s] of p.sections.entries()) {
    const fi = s.fields.findIndex((f) => f.id === fieldId);
    if (fi >= 0) return { pi, si, fi };
  }
  return null;
}
function locateSection(d: FormDefinition, sectionId: string) {
  for (const [pi, p] of d.pages.entries()) {
    const si = p.sections.findIndex((s) => s.id === sectionId);
    if (si >= 0) return { pi, si };
  }
  return null;
}
/** Removes rules that point at a deleted item, and conditions that test a deleted question. */
function prune(d: FormDefinition): FormDefinition {
  const fieldIds = new Set(fieldsOf(d).map((f) => f.id));
  const sectionIds = new Set(d.pages.flatMap((p) => p.sections.map((s) => s.id)));
  const pageIds = new Set(d.pages.map((p) => p.id));
  d.rules = d.rules.filter((r) => fieldIds.has(r.target) || sectionIds.has(r.target)).map((r) => ({ ...r, conditions: r.conditions.filter((c) => fieldIds.has(c.field)) })).filter((r) => r.conditions.length);
  for (const p of d.pages) p.skips = p.skips.filter((k) => k.goto === "end" || pageIds.has(k.goto)).map((k) => ({ ...k, conditions: k.conditions.filter((c) => fieldIds.has(c.field)) })).filter((k) => k.conditions.length);
  return d;
}

function PaletteItem({ type, onAdd }: { type: FieldType; onAdd: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `palette:${type}`, data: { kind: "palette", type } });
  return (
    <button
      type="button"
      ref={setNodeRef}
      className="mf-palette-item"
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.6 : 1 }}
      onClick={onAdd}
      title={`Drag onto a section, or click to add to the selected section`}
      {...listeners}
      {...attributes}
    >
      {FIELD_LABELS[type]}
    </button>
  );
}

function FieldCard({ field, sectionId, selected, problem, onSelect, onMove, onDuplicate, onDelete }: { field: Field; sectionId: string; selected: boolean; problem: boolean; onSelect: () => void; onMove: (dir: -1 | 1) => void; onDuplicate: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id, data: { kind: "field", sectionId } });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }} className={`mf-card${selected ? " is-selected" : ""}${problem ? " has-problem" : ""}${field.width === "half" ? " is-half" : ""}`}>
      <button type="button" className="mf-grip" aria-label={`Drag to move "${field.label || field.key}"`} {...listeners} {...attributes}>⠿</button>
      <button type="button" className="mf-card-body" onClick={onSelect} aria-pressed={selected}>
        <small>{FIELD_LABELS[field.type]}{field.required ? " · required" : ""}{field.format ? ` · ${field.format.toUpperCase()}` : field.sensitive ? " · sensitive" : ""}</small>
        <b>{field.type === "paragraph" ? (field.text ?? "").slice(0, 80) : field.label || <i>No label</i>}</b>
        {!DISPLAY_TYPES.includes(field.type) && <code>{field.key}</code>}
      </button>
      <span className="mf-card-tools">
        <button type="button" onClick={() => onMove(-1)} aria-label="Move up">↑</button>
        <button type="button" onClick={() => onMove(1)} aria-label="Move down">↓</button>
        <button type="button" onClick={onDuplicate} aria-label="Duplicate">⧉</button>
        <button type="button" onClick={onDelete} aria-label="Delete">✕</button>
      </span>
    </div>
  );
}

function SectionBox({ section, children, selected, onSelect, empty }: { section: Section; children: React.ReactNode; selected: boolean; onSelect: () => void; empty: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `section:${section.id}`, data: { kind: "section", sectionId: section.id } });
  return (
    <div ref={setNodeRef} className={`mf-section-box${isOver ? " is-over" : ""}${selected ? " is-selected" : ""}`}>
      <button type="button" className="mf-section-head" onClick={onSelect}>{section.title || <i>Untitled section</i>}</button>
      {children}
      {empty && <p className="mf-drop-hint">Drag a question here, or click one in the list on the left.</p>}
    </div>
  );
}

function ConditionsEditor({ conditions, earlier, onChange }: { conditions: Condition[]; earlier: Field[]; onChange: (c: Condition[]) => void }) {
  const set = (i: number, patch: Partial<Condition>) => onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="mf-conds">
      {conditions.map((c, i) => {
        const f = earlier.find((x) => x.id === c.field);
        const noValue = c.op === "answered" || c.op === "empty";
        return (
          <div key={i} className="mf-cond">
            <select value={c.field} onChange={(e) => set(i, { field: e.target.value, value: "" })} aria-label="Question">
              <option value="">Question…</option>
              {earlier.map((x) => <option key={x.id} value={x.id}>{x.label || x.key}</option>)}
            </select>
            <select value={c.op} onChange={(e) => set(i, { op: e.target.value as Condition["op"] })} aria-label="Test">
              {CONDITION_OPS.filter((op) => (op === "gt" || op === "lt" ? f?.type === "number" || f?.type === "date" : true)).map((op) => <option key={op} value={op}>{OP_LABELS[op]}</option>)}
            </select>
            {!noValue && (f?.options ? (
              <select value={c.value ?? ""} onChange={(e) => set(i, { value: e.target.value })} aria-label="Value"><option value="">Value…</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
            ) : (
              <input type={f?.type === "date" ? "date" : f?.type === "number" ? "number" : "text"} value={c.value ?? ""} onChange={(e) => set(i, { value: e.target.value })} aria-label="Value" maxLength={120} />
            ))}
            <button type="button" className="monarch-link" onClick={() => onChange(conditions.filter((_, j) => j !== i))}>Remove</button>
          </div>
        );
      })}
      {conditions.length < LIMITS.conditions && <button type="button" className="monarch-link" onClick={() => onChange([...conditions, { field: earlier[earlier.length - 1]?.id ?? "", op: "equals", value: "" }])} disabled={!earlier.length}>+ Add a condition</button>}
      {!earlier.length && <small className="monarch-muted">Rules can only test questions that come earlier in the form.</small>}
    </div>
  );
}

export function FormBuilder(props: Props) {
  const [def, setDef] = useState<FormDefinition>(props.initial);
  const [pageId, setPageId] = useState(props.initial.pages[0]?.id ?? "");
  const [sel, setSel] = useState<Sel>(null);
  const [save, setSave] = useState<{ state: "saved" | "saving" | "error"; at: string | null; error?: string }>({ state: "saved", at: props.savedAt });
  const first = useRef(true);
  const pending = useRef<Promise<unknown> | null>(null);
  const publishRef = useRef<HTMLFormElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const problem = useMemo(() => {
    try {
      checkDefinition(def);
      return null;
    } catch (e) {
      return { message: e instanceof Error ? e.message : "Something needs fixing.", target: (e as { target?: string }).target };
    }
  }, [def]);

  const doSave = useCallback(async (d: FormDefinition) => {
    setSave((s) => ({ ...s, state: "saving" }));
    const r = await saveDraftAction(props.formId, d).catch(() => ({ ok: false as const, error: "Could not reach the server." }));
    setSave(r.ok ? { state: "saved", at: r.savedAt } : { state: "error", at: null, error: r.error });
  }, [props.formId]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => { pending.current = doSave(def); }, 1200);
    return () => clearTimeout(t);
  }, [def, doSave]);

  const update = (fn: (d: FormDefinition) => void) => setDef((d) => {
    const next = clone(d);
    fn(next);
    return prune(next);
  });
  const page = def.pages.find((p) => p.id === pageId) ?? def.pages[0];
  const taken = () => new Set(fieldsOf(def).map((f) => f.key));
  const total = fieldsOf(def).length;

  const targetSection = (): string => {
    if (sel?.kind === "section" && page.sections.some((s) => s.id === sel.id)) return sel.id;
    if (sel?.kind === "field") {
      const at = locate(def, sel.id);
      if (at && def.pages[at.pi].id === page.id) return page.sections[at.si].id;
    }
    return page.sections[page.sections.length - 1].id;
  };

  const addField = (type: FieldType, sectionId: string, index?: number) => {
    if (total >= LIMITS.fields) return;
    const field = newField(type, taken());
    if (type === "signature" && fieldsOf(def).some((f) => f.type === "signature")) return;
    update((d) => {
      const at = locateSection(d, sectionId);
      if (!at) return;
      const list = d.pages[at.pi].sections[at.si].fields;
      list.splice(index ?? list.length, 0, field);
    });
    setSel({ kind: "field", id: field.id });
  };
  const moveField = (fieldId: string, toSection: string, toIndex: number) => update((d) => {
    const from = locate(d, fieldId);
    const to = locateSection(d, toSection);
    if (!from || !to) return;
    const [f] = d.pages[from.pi].sections[from.si].fields.splice(from.fi, 1);
    const list = d.pages[to.pi].sections[to.si].fields;
    list.splice(Math.min(toIndex, list.length), 0, f);
  });
  const stepField = (fieldId: string, dir: -1 | 1) => update((d) => {
    const at = locate(d, fieldId);
    if (!at) return;
    const sections = d.pages.flatMap((p) => p.sections);
    const flatIndex = sections.indexOf(d.pages[at.pi].sections[at.si]);
    const list = d.pages[at.pi].sections[at.si].fields;
    const next = at.fi + dir;
    if (next >= 0 && next < list.length) {
      [list[at.fi], list[next]] = [list[next], list[at.fi]];
      return;
    }
    // At the edge of a section: move into the neighbouring section (on this or the next page).
    const other = sections[flatIndex + dir];
    if (!other) return;
    const [f] = list.splice(at.fi, 1);
    if (dir < 0) other.fields.push(f);
    else other.fields.unshift(f);
  });
  const updateField = (id: string, patch: Partial<Field>) => update((d) => {
    const at = locate(d, id);
    if (at) Object.assign(d.pages[at.pi].sections[at.si].fields[at.fi], patch);
  });

  function onDragEnd(e: DragEndEvent) {
    const a = e.active.data.current as { kind: string; type?: FieldType; sectionId?: string } | undefined;
    const o = e.over?.data.current as { kind: string; sectionId?: string } | undefined;
    if (!a || !o || !e.over) return;
    const overSection = o.sectionId!;
    const overIndex = o.kind === "field" ? Math.max(0, (locate(def, String(e.over.id))?.fi ?? 0)) : Number.MAX_SAFE_INTEGER;
    if (a.kind === "palette" && a.type) addField(a.type, overSection, overIndex === Number.MAX_SAFE_INTEGER ? undefined : overIndex);
    else if (a.kind === "field" && e.active.id !== e.over.id) moveField(String(e.active.id), overSection, overIndex);
  }

  async function publish() {
    if (pending.current) await pending.current;
    await doSave(def);
    publishRef.current?.requestSubmit();
  }

  // ------------------------------------------------------------ settings panel
  const order = def.pages.flatMap((p) => [p.id, ...p.sections.flatMap((s) => [s.id, ...s.fields.map((f) => f.id)])]);
  const earlierThan = (id: string) => fieldsOf(def).filter((f) => order.indexOf(f.id) < order.indexOf(id) && !DISPLAY_TYPES.includes(f.type));
  const rulesFor = (target: string) => def.rules.filter((r) => r.target === target);
  const setRules = (target: string, rules: ShowRule[]) => update((d) => { d.rules = [...d.rules.filter((r) => r.target !== target), ...rules]; });

  // Render helpers (plain functions, not components, so inputs keep focus while typing).
  const rulesEditor = (target: string) => {
    const rules = rulesFor(target);
    const earlier = earlierThan(target);
    return (
      <fieldset className="mf-logic"><legend>Show or hide</legend>
        {rules.map((r) => (
          <div key={r.id} className="mf-rule">
            <div className="mf-cond">
              <select value={r.action} onChange={(e) => setRules(target, rules.map((x) => (x.id === r.id ? { ...x, action: e.target.value as ShowRule["action"] } : x)))} aria-label="Show or hide"><option value="show">Show only when</option><option value="hide">Hide when</option></select>
              <select value={r.match} onChange={(e) => setRules(target, rules.map((x) => (x.id === r.id ? { ...x, match: e.target.value as ShowRule["match"] } : x)))} aria-label="All or any"><option value="all">all of these are true</option><option value="any">any of these is true</option></select>
              <button type="button" className="monarch-link" onClick={() => setRules(target, rules.filter((x) => x.id !== r.id))}>Remove rule</button>
            </div>
            <ConditionsEditor conditions={r.conditions} earlier={earlier} onChange={(c) => setRules(target, rules.map((x) => (x.id === r.id ? { ...x, conditions: c } : x)))} />
          </div>
        ))}
        <button type="button" className="monarch-link" disabled={!earlier.length} onClick={() => setRules(target, [...rules, { id: newId("r"), target, action: "show", match: "all", conditions: [{ field: earlier[earlier.length - 1].id, op: "equals", value: "" }] }])}>+ Add a show/hide rule</button>
        {!earlier.length && <small className="monarch-muted">Add questions before this one to show or hide it based on their answers.</small>}
      </fieldset>
    );
  };

  const fieldPanel = (f: Field) => {
    const num = (v: string) => (v === "" ? null : Number(v));
    const display = DISPLAY_TYPES.includes(f.type);
    return (
      <div className="mf-panel-body">
        <h3>{FIELD_LABELS[f.type]}</h3>
        {f.type === "paragraph" ? (
          <label>Text<textarea rows={6} value={f.text ?? ""} onChange={(e) => updateField(f.id, { text: e.target.value })} maxLength={3000} /></label>
        ) : (
          <label>{f.type === "heading" ? "Heading" : "Question"}<input value={f.label} onChange={(e) => updateField(f.id, { label: e.target.value })} maxLength={300} /></label>
        )}
        {!display && (
          <>
            <label>Key <small className="monarch-muted">(names the answer in the PDF, CSV, workflows and {"{{form.key}}"} merge fields)</small>
              <span style={{ display: "flex", gap: 6 }}>
                <input value={f.key} onChange={(e) => updateField(f.id, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40) })} maxLength={40} />
                <button type="button" className="monarch-secondary" onClick={() => { const t = taken(); t.delete(f.key); updateField(f.id, { key: keyFromLabel(f.label, t) }); }}>From question</button>
              </span>
            </label>
            <label>Help text (optional)<textarea rows={2} value={f.help ?? ""} onChange={(e) => updateField(f.id, { help: e.target.value })} maxLength={500} /></label>
            {["short_text", "long_text", "number", "email", "phone"].includes(f.type) && <label>Placeholder (optional)<input value={f.placeholder ?? ""} onChange={(e) => updateField(f.id, { placeholder: e.target.value })} maxLength={120} /></label>}
            <label className="monarch-check"><input type="checkbox" checked={f.required} onChange={(e) => updateField(f.id, { required: e.target.checked })} /> Required</label>
            {!["radio", "checkboxes", "address", "file", "signature"].includes(f.type) && (
              <label>Width<select value={f.width} onChange={(e) => updateField(f.id, { width: e.target.value as Field["width"] })}><option value="full">Full width</option><option value="half">Half (two side by side on a computer)</option></select></label>
            )}
          </>
        )}
        {f.type === "short_text" && (
          <>
            <label>Check as<select value={f.format ?? ""} onChange={(e) => updateField(f.id, { format: (e.target.value || null) as Field["format"], sensitive: e.target.value ? true : f.sensitive })}><option value="">Any text</option>{IDENTIFIER_FORMATS.map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}</select></label>
            <label className="monarch-check"><input type="checkbox" checked={!!f.sensitive} disabled={!!f.format} onChange={(e) => updateField(f.id, { sensitive: e.target.checked })} /> Sensitive: store encrypted, show masked</label>
          </>
        )}
        {(f.type === "short_text" || f.type === "long_text") && !f.format && (
          <span className="mf-pair">
            <label>Min length<input type="number" min={0} value={f.minLength ?? ""} onChange={(e) => updateField(f.id, { minLength: num(e.target.value) })} /></label>
            <label>Max length<input type="number" min={1} value={f.maxLength ?? ""} onChange={(e) => updateField(f.id, { maxLength: num(e.target.value) })} /></label>
          </span>
        )}
        {f.type === "number" && (
          <>
            <span className="mf-pair">
              <label>Minimum<input type="number" value={f.min ?? ""} onChange={(e) => updateField(f.id, { min: num(e.target.value) })} /></label>
              <label>Maximum<input type="number" value={f.max ?? ""} onChange={(e) => updateField(f.id, { max: num(e.target.value) })} /></label>
            </span>
            <label className="monarch-check"><input type="checkbox" checked={!!f.decimals} onChange={(e) => updateField(f.id, { decimals: e.target.checked })} /> Allow decimals</label>
          </>
        )}
        {f.type === "phone" && <label>Format<select value={f.phoneFormat ?? "us"} onChange={(e) => updateField(f.id, { phoneFormat: e.target.value as Field["phoneFormat"] })}><option value="us">US (10 digits)</option><option value="intl">International (with country code)</option></select></label>}
        {f.type === "date" && (["dateMin", "dateMax"] as const).map((k) => {
          const b = f[k];
          return (
            <span key={k} className="mf-pair">
              <label>{k === "dateMin" ? "Earliest" : "Latest"}<select value={b?.kind ?? ""} onChange={(e) => updateField(f.id, { [k]: e.target.value === "fixed" ? { kind: "fixed", date: new Date().toISOString().slice(0, 10) } : e.target.value === "relative" ? { kind: "relative", days: 0 } : null })}><option value="">No limit</option><option value="fixed">A date</option><option value="relative">Today ± days</option></select></label>
              {b?.kind === "fixed" && <label>Date<input type="date" value={b.date} onChange={(e) => updateField(f.id, { [k]: { kind: "fixed", date: e.target.value } })} /></label>}
              {b?.kind === "relative" && <label>Days from today<input type="number" value={b.days} onChange={(e) => updateField(f.id, { [k]: { kind: "relative", days: Number(e.target.value) || 0 } })} /></label>}
            </span>
          );
        })}
        {(f.type === "dropdown" || f.type === "radio" || f.type === "checkboxes") && (
          <label>Options, one per line<textarea rows={6} value={(f.options ?? []).join("\n")} onChange={(e) => updateField(f.id, { options: e.target.value.split("\n").map((x) => x.slice(0, 120)) })} /></label>
        )}
        {f.type === "checkboxes" && (
          <span className="mf-pair">
            <label>Tick at least<input type="number" min={0} value={f.minSelected ?? ""} onChange={(e) => updateField(f.id, { minSelected: num(e.target.value) })} /></label>
            <label>Tick at most<input type="number" min={1} value={f.maxSelected ?? ""} onChange={(e) => updateField(f.id, { maxSelected: num(e.target.value) })} /></label>
          </span>
        )}
        {f.type === "file" && (
          <>
            <fieldset><legend>Accepted files</legend>{FILE_KINDS.map((k) => <label key={k} className="monarch-check"><input type="checkbox" checked={(f.fileTypes ?? []).includes(k)} onChange={(e) => updateField(f.id, { fileTypes: e.target.checked ? [...(f.fileTypes ?? []), k] : (f.fileTypes ?? []).filter((x) => x !== k) })} /> {k.toUpperCase()}</label>)}</fieldset>
            <label>Most files<select value={f.maxFiles ?? 1} onChange={(e) => updateField(f.id, { maxFiles: Number(e.target.value) })}>{Array.from({ length: MAX_FILES_PER_FIELD }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <small className="monarch-muted">Up to 10 MB per file. Files are checked by their content when the form is submitted.</small>
          </>
        )}
        {f.type === "address" && (
          <>
            <label className="monarch-check"><input type="checkbox" checked={f.line2 !== false} onChange={(e) => updateField(f.id, { line2: e.target.checked })} /> Second street line</label>
            <label className="monarch-check"><input type="checkbox" checked={!!f.country} onChange={(e) => updateField(f.id, { country: e.target.checked })} /> Ask for the country (US addresses are checked for state and ZIP)</label>
          </>
        )}
        {f.type === "signature" && <p className="monarch-muted">Respondents agree to your signing consent statement (Settings) before they can sign. A form has one signature.</p>}
        {rulesEditor(f.id)}
      </div>
    );
  };

  const selField = sel?.kind === "field" ? fieldsOf(def).find((f) => f.id === sel.id) : undefined;
  const selSection = sel?.kind === "section" ? def.pages.flatMap((p) => p.sections).find((s) => s.id === sel.id) : undefined;
  const pageIndex = def.pages.findIndex((p) => p.id === page.id);
  const laterPages = def.pages.slice(pageIndex + 2);
  const setSkips = (skips: SkipRule[]) => update((d) => { d.pages[pageIndex].skips = skips; });
  // Skip rules test questions up to the end of this page.
  const skipFields = pageIndex + 1 < def.pages.length ? earlierThan(def.pages[pageIndex + 1].id) : [];

  return (
    <div className="mf-builder">
      <div className="mf-toolbar">
        <span className={`mf-save is-${save.state}`} role="status">{save.state === "saving" ? "Saving…" : save.state === "error" ? `Not saved: ${save.error}` : save.at ? `Draft saved ${new Date(save.at).toLocaleTimeString()}` : "Draft"}</span>
        {problem && <button type="button" className="mf-problem" onClick={() => { if (problem.target) { const f = locate(def, problem.target); if (f) { setPageId(def.pages[f.pi].id); setSel({ kind: "field", id: problem.target }); } else if (locateSection(def, problem.target)) setSel({ kind: "section", id: problem.target }); else if (def.pages.some((p) => p.id === problem.target)) { setPageId(problem.target); setSel({ kind: "page", id: problem.target }); } } }}>Fix before publishing: {problem.message}</button>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="monarch-secondary" href={`/forms/${props.formId}/preview`} target="_blank" rel="noreferrer">Preview</a>
          {props.publishedVersion && <a className="monarch-secondary" href={`/forms/${props.formId}/test`} target="_blank" rel="noreferrer">Test the published form</a>}
          <form ref={publishRef} action={publishFormAction}><input type="hidden" name="id" value={props.formId} /></form>
          <button type="button" className="monarch-primary" onClick={publish} disabled={!props.canPublish || !!problem || save.state === "saving"}>{props.publishedVersion ? `Publish version ${props.publishedVersion + 1}` : "Publish"}</button>
        </span>
      </div>
      {props.publicUrl && <p className="monarch-muted" style={{ margin: "0 0 10px" }}>Public link: <code>{props.publicUrl}</code>. Changes here stay in the draft until you publish.</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div className="mf-columns">
          <aside className="mf-palette" aria-label="Question types">
            <h3>Add a question</h3>
            {FIELD_TYPES.map((t) => <PaletteItem key={t} type={t} onAdd={() => addField(t, targetSection())} />)}
            <small className="monarch-muted">{total}/{LIMITS.fields} questions</small>
          </aside>
          <div className="mf-canvas">
            <div className="mf-pages" role="tablist" aria-label="Pages">
              {def.pages.map((p, i) => (
                <button key={p.id} type="button" role="tab" aria-selected={p.id === page.id} className={p.id === page.id ? "is-active" : undefined} onClick={() => { setPageId(p.id); setSel({ kind: "page", id: p.id }); }}>{i + 1}. {p.title}</button>
              ))}
              {def.pages.length < LIMITS.pages && <button type="button" onClick={() => { const p: Page = { id: newId("p"), title: `Page ${def.pages.length + 1}`, sections: [{ id: newId("s"), title: "", fields: [] }], skips: [] }; update((d) => { d.pages.push(p); }); setPageId(p.id); setSel({ kind: "page", id: p.id }); }}>+ Page</button>}
            </div>
            {page.sections.map((s) => (
              <SectionBox key={s.id} section={s} selected={sel?.kind === "section" && sel.id === s.id} onSelect={() => setSel({ kind: "section", id: s.id })} empty={!s.fields.length}>
                <SortableContext items={s.fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                  {s.fields.map((f) => (
                    <FieldCard
                      key={f.id} field={f} sectionId={s.id} selected={sel?.kind === "field" && sel.id === f.id} problem={problem?.target === f.id}
                      onSelect={() => setSel({ kind: "field", id: f.id })} onMove={(dir) => stepField(f.id, dir)}
                      onDuplicate={() => { const copy = { ...clone(f), id: newId("f"), key: keyFromLabel(f.label || f.key, taken()) }; if (f.type === "signature") return; update((d) => { const at = locate(d, f.id); if (at) d.pages[at.pi].sections[at.si].fields.splice(at.fi + 1, 0, copy); }); setSel({ kind: "field", id: copy.id }); }}
                      onDelete={() => { if (!confirm(`Delete "${f.label || f.key}"? Rules that use it are removed too.`)) return; update((d) => { const at = locate(d, f.id); if (at) d.pages[at.pi].sections[at.si].fields.splice(at.fi, 1); }); setSel(null); }}
                    />
                  ))}
                </SortableContext>
              </SectionBox>
            ))}
            {page.sections.length < LIMITS.sectionsPerPage && <button type="button" className="monarch-secondary" onClick={() => { const s: Section = { id: newId("s"), title: "New section", fields: [] }; update((d) => { d.pages[pageIndex].sections.push(s); }); setSel({ kind: "section", id: s.id }); }}>+ Add a section</button>}
          </div>
          <aside className="mf-panel" aria-label="Settings for the selected item">
            {selField ? fieldPanel(selField) : selSection ? (
              <div className="mf-panel-body">
                <h3>Section</h3>
                <label>Title<input value={selSection.title} onChange={(e) => update((d) => { const at = locateSection(d, selSection.id); if (at) d.pages[at.pi].sections[at.si].title = e.target.value; })} maxLength={200} /></label>
                <label>Description (optional)<textarea rows={3} value={selSection.description ?? ""} onChange={(e) => update((d) => { const at = locateSection(d, selSection.id); if (at) d.pages[at.pi].sections[at.si].description = e.target.value; })} maxLength={1000} /></label>
                <span className="mf-card-tools">
                  <button type="button" onClick={() => update((d) => { const at = locateSection(d, selSection.id); if (!at || at.si === 0) return; const list = d.pages[at.pi].sections; [list[at.si - 1], list[at.si]] = [list[at.si], list[at.si - 1]]; })}>↑ Move up</button>
                  <button type="button" onClick={() => update((d) => { const at = locateSection(d, selSection.id); if (!at) return; const list = d.pages[at.pi].sections; if (at.si >= list.length - 1) return; [list[at.si + 1], list[at.si]] = [list[at.si], list[at.si + 1]]; })}>↓ Move down</button>
                  <button type="button" onClick={() => { if (page.sections.length < 2) return alert("A page needs at least one section."); if (selSection.fields.length && !confirm(`Delete this section and its ${selSection.fields.length} question(s)?`)) return; update((d) => { const at = locateSection(d, selSection.id); if (at) d.pages[at.pi].sections.splice(at.si, 1); }); setSel(null); }}>✕ Delete section</button>
                </span>
                {rulesEditor(selSection.id)}
              </div>
            ) : (
              <div className="mf-panel-body">
                <h3>Page {pageIndex + 1}</h3>
                <label>Title<input value={page.title} onChange={(e) => update((d) => { d.pages[pageIndex].title = e.target.value; })} maxLength={120} /></label>
                <span className="mf-card-tools">
                  <button type="button" onClick={() => update((d) => { if (pageIndex === 0) return; [d.pages[pageIndex - 1], d.pages[pageIndex]] = [d.pages[pageIndex], d.pages[pageIndex - 1]]; })}>← Move earlier</button>
                  <button type="button" onClick={() => update((d) => { if (pageIndex >= d.pages.length - 1) return; [d.pages[pageIndex + 1], d.pages[pageIndex]] = [d.pages[pageIndex], d.pages[pageIndex + 1]]; })}>Move later →</button>
                  <button type="button" onClick={() => { if (def.pages.length < 2) return alert("A form needs at least one page."); if (!confirm(`Delete "${page.title}" and everything on it?`)) return; update((d) => { d.pages.splice(pageIndex, 1); }); setPageId(def.pages[pageIndex === 0 ? 1 : pageIndex - 1].id); setSel(null); }}>✕ Delete page</button>
                </span>
                <fieldset className="mf-logic"><legend>Skip logic: after this page</legend>
                  {page.skips.map((k) => (
                    <div key={k.id} className="mf-rule">
                      <div className="mf-cond">
                        <span>When</span>
                        <select value={k.match} onChange={(e) => setSkips(page.skips.map((x) => (x.id === k.id ? { ...x, match: e.target.value as SkipRule["match"] } : x)))} aria-label="All or any"><option value="all">all of these are true</option><option value="any">any of these is true</option></select>
                        <span>go to</span>
                        <select value={k.goto} onChange={(e) => setSkips(page.skips.map((x) => (x.id === k.id ? { ...x, goto: e.target.value } : x)))} aria-label="Go to">{laterPages.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}<option value="end">the end (submit)</option></select>
                        <button type="button" className="monarch-link" onClick={() => setSkips(page.skips.filter((x) => x.id !== k.id))}>Remove</button>
                      </div>
                      <ConditionsEditor conditions={k.conditions} earlier={skipFields} onChange={(c) => setSkips(page.skips.map((x) => (x.id === k.id ? { ...x, conditions: c } : x)))} />
                    </div>
                  ))}
                  {skipFields.length ? (
                    <button type="button" className="monarch-link" onClick={() => setSkips([...page.skips, { id: newId("r"), match: "all", conditions: [{ field: skipFields[skipFields.length - 1].id, op: "equals", value: "" }], goto: laterPages[0]?.id ?? "end" }])}>+ Add a skip rule</button>
                  ) : <small className="monarch-muted">Skip rules jump past later pages. Add a question and at least one more page first.</small>}
                  <small className="monarch-muted">The first rule that matches wins; with none, the next page shows. Skips only go forward.</small>
                </fieldset>
                <p className="monarch-muted">Select a question or section to edit it.</p>
              </div>
            )}
          </aside>
        </div>
      </DndContext>
    </div>
  );
}
