import { Modal } from "@/components/ui/modal";
import { archiveReturnAction, editReturnAction } from "@/app/(admin)/workspace/actions";
import { EDITABLE_PREP } from "@/lib/workspace/service.ts";
import { PREP_STATUSES, type ClientReturn, type ClientTask } from "@/lib/workspace/types.ts";
import type { StaffMember } from "@/lib/staff/assign.ts";

export type ReturnHistoryLine = { id: string; text: string; at: string; by: string };

/** A return's own window: where it stands, who prepares it, its dates and notes, the tasks for it and what has been done to it. */
export function ReturnEditor({ r, label, stages, staff, tasks, history, label2 = "Open" }: {
  r: ClientReturn; label: string; stages: { id: string; name: string }[]; staff: StaffMember[]; tasks: ClientTask[]; history: ReturnHistoryLine[]; label2?: string;
}) {
  const handedOff = r.prep_status === "handed_off";
  const known = !r.assignee_id || staff.some((s) => s.id === r.assignee_id);
  return (
    <Modal label={label2} title={label} className="monarch-secondary" wide>
      <form action={editReturnAction} className="monarch-form">
        <input type="hidden" name="id" value={r.id} /><input type="hidden" name="client_id" value={r.client_id} />
        <label>Stage
          <select name="stage_id" defaultValue={r.stage_id}>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </label>
        <label>Preparer
          <select name="assignee_id" defaultValue={known ? r.assignee_id ?? "" : ""}>
            <option value="">No one</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          {!known && <small className="monarch-muted">Currently a former teammate.</small>}
        </label>
        <label>Preparation
          {handedOff ? <input value={`${PREP_STATUSES.handed_off}${r.handed_off_at ? ` · ${r.handed_off_at.slice(0, 10)}` : ""}`} disabled /> : (
            <select name="prep_status" defaultValue={r.prep_status}>{EDITABLE_PREP.map((k) => <option key={k} value={k}>{PREP_STATUSES[k]}</option>)}</select>
          )}
        </label>
        <label>Due date<input type="date" name="due_on" defaultValue={r.due_on ?? ""} /></label>
        <label>Filed date<input type="date" name="filed_on" defaultValue={r.filed_on ?? ""} /></label>
        <label className="is-wide">Notes<textarea name="notes" rows={4} maxLength={2000} defaultValue={r.notes ?? ""} placeholder="Anything the next person should know about this return." /></label>
        <div className="is-wide ac-actions"><button className="monarch-primary" data-no-confirm>Save return</button></div>
      </form>

      <h3 style={{ margin: "18px 0 6px" }}>Tasks for this return</h3>
      {tasks.length === 0 ? <p className="monarch-muted">None. Add one from the Tasks tab and choose this return.</p> : (
        <ul className="cl-list">
          {tasks.map((t) => <li key={t.id}><span style={t.done_at ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>{t.title}{t.due_on ? <small className="monarch-subcell">due {t.due_on}</small> : null}</span></li>)}
        </ul>
      )}

      <h3 style={{ margin: "18px 0 6px" }}>History</h3>
      {history.length === 0 ? <p className="monarch-muted">Nothing recorded yet.</p> : (
        <ul className="cl-list">{history.slice(0, 15).map((h) => <li key={h.id}><span>{h.text}<small className="monarch-subcell">{h.by} · {new Date(h.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</small></span></li>)}</ul>
      )}

      <form action={archiveReturnAction} style={{ marginTop: 18 }}>
        <input type="hidden" name="id" value={r.id} /><input type="hidden" name="client_id" value={r.client_id} />
        <button className="monarch-secondary is-danger">Archive this return</button>
        <small className="monarch-muted"> For a return added by mistake. Its history stays.</small>
      </form>
    </Modal>
  );
}
