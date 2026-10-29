import { Modal } from "@/components/ui/modal";
import { archiveReturnAction, editReturnAction, removeStateFilingAction, saveStateFilingAction } from "@/app/(admin)/workspace/actions";
import { EDITABLE_PREP } from "@/lib/workspace/service.ts";
import { formatResult } from "@/lib/workspace/rules.ts";
import { EfileFields } from "@/components/workspace/efile-fields";
import { FILING_STATUSES, FORM_TYPES, PREP_STATUSES, STATE_FILING_STATUSES, type ClientReturn, type ClientTask, type StateFiling } from "@/lib/workspace/types.ts";
import type { StaffMember } from "@/lib/staff/assign.ts";

export type ReturnHistoryLine = { id: string; text: string; at: string; by: string };

/** A return's own window: where it stands, who prepares it, its dates and notes, the tasks for it and what has been done to it. */
export function ReturnEditor({ r, label, stages, staff, tasks, history, states = [], label2 = "Open" }: {
  r: ClientReturn; label: string; stages: { id: string; name: string }[]; staff: StaffMember[]; tasks: ClientTask[]; history: ReturnHistoryLine[]; states?: StateFiling[]; label2?: string;
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
        <h3 className="is-wide" style={{ margin: "8px 0 0" }}>Return details</h3>
        <label>Form
          <select name="form_type" defaultValue={r.form_type ?? ""}><option value="">Not set</option>{Object.entries(FORM_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label>Filing status
          <select name="filing_status" defaultValue={r.filing_status ?? ""}><option value="">Not set</option>{Object.entries(FILING_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <EfileFields status={r.efile_status ?? "not_sent"} on={r.efile_on ?? ""} reason={r.efile_reject_reason ?? ""} />
        <label>Federal amount
          <input name="federal_result" inputMode="decimal" placeholder="1,234.50 or -1,234.50" defaultValue={r.federal_result_cents != null ? (r.federal_result_cents / 100).toFixed(2) : ""} />
          <small className="monarch-muted">A refund has no sign. An amount the client owes has a minus.</small>
        </label>
        <label>Fee amount<input name="fee" inputMode="decimal" placeholder="0.00" defaultValue={r.fee_cents != null ? (r.fee_cents / 100).toFixed(2) : ""} /></label>
        <label className="is-wide">Notes<textarea name="notes" rows={4} maxLength={2000} defaultValue={r.notes ?? ""} placeholder="Anything the next person should know about this return." /></label>
        <div className="is-wide ac-actions"><button className="monarch-primary" data-no-confirm>Save return</button></div>
      </form>

      <h3 style={{ margin: "18px 0 6px" }}>State returns</h3>
      {states.length === 0 ? <p className="monarch-muted">None added.</p> : (
        <ul className="cl-list">
          {states.map((x) => (
            <li key={x.id}>
              <span><b>{x.state}</b><small className="monarch-subcell">{STATE_FILING_STATUSES[x.status]}{x.filed_on ? ` · filed ${x.filed_on}` : ""}{x.result_cents != null ? ` · ${formatResult(x.result_cents)}` : ""}</small></span>
              <form action={removeStateFilingAction}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="return_id" value={r.id} /><input type="hidden" name="client_id" value={r.client_id} /><button className="monarch-link is-danger">Remove</button></form>
            </li>
          ))}
        </ul>
      )}
      <form action={saveStateFilingAction} className="cl-quick" style={{ marginTop: 8 }}>
        <input type="hidden" name="return_id" value={r.id} /><input type="hidden" name="client_id" value={r.client_id} />
        <input name="state" maxLength={2} placeholder="State, like LA" aria-label="State" required style={{ width: 120, textTransform: "uppercase" }} />
        <select name="status" aria-label="State return status" defaultValue="not_started">{Object.entries(STATE_FILING_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input type="date" name="filed_on" aria-label="Filed date" />
        <input name="result" inputMode="decimal" placeholder="State amount, -1.00 if owed" aria-label="State amount" style={{ width: 190 }} />
        <button className="monarch-secondary" data-no-confirm>Add or update</button>
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
