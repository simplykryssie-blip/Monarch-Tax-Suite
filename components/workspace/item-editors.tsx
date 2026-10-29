import { Modal } from "@/components/ui/modal";
import { SubmitOnce } from "@/components/admin/submit-once";
import { deleteNoteAction, deleteTaskAction, editNoteAction, editTaskAction } from "@/app/(admin)/workspace/actions";
import type { ClientNote, ClientTask } from "@/lib/workspace/types.ts";

/** Edit and Delete for one saved task. Delete asks first (the app-wide rule). */
export function TaskEditor({ task, returns, back }: { task: ClientTask; returns: { id: string; label: string }[]; back: string }) {
  return (
    <span className="item-actions">
      <Modal label="Edit" title="Edit task" className="monarch-link">
        <form action={editTaskAction} className="monarch-form">
          <input type="hidden" name="id" value={task.id} /><input type="hidden" name="client_id" value={task.client_id} /><input type="hidden" name="back" value={back} />
          <label className="is-wide">Task<input name="title" required maxLength={200} defaultValue={task.title} /></label>
          <label>Due<input type="date" name="due_on" defaultValue={task.due_on ?? ""} /></label>
          <label>For which return
            <select name="return_id" defaultValue={task.return_id ?? ""}><option value="">No specific return</option>{returns.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
          </label>
          <div className="is-wide ac-actions"><SubmitOnce className="monarch-primary">Save task</SubmitOnce></div>
        </form>
      </Modal>
      <form action={deleteTaskAction}>
        <input type="hidden" name="id" value={task.id} /><input type="hidden" name="client_id" value={task.client_id} /><input type="hidden" name="back" value={back} />
        <button className="monarch-link is-danger" data-confirm={`Delete the task "${task.title.slice(0, 60)}"? This cannot be undone.`}>Delete</button>
      </form>
    </span>
  );
}

/** Edit and Delete for one saved note. */
export function NoteEditor({ note, back }: { note: ClientNote; back: string }) {
  return (
    <span className="item-actions">
      <Modal label="Edit" title="Edit note" className="monarch-link">
        <form action={editNoteAction} className="monarch-form">
          <input type="hidden" name="id" value={note.id} /><input type="hidden" name="client_id" value={note.client_id} /><input type="hidden" name="back" value={back} />
          <label className="is-wide">Note<textarea name="body" required rows={6} maxLength={4000} defaultValue={note.body} /></label>
          <div className="is-wide ac-actions"><SubmitOnce className="monarch-primary">Save note</SubmitOnce></div>
        </form>
      </Modal>
      <form action={deleteNoteAction}>
        <input type="hidden" name="id" value={note.id} /><input type="hidden" name="client_id" value={note.client_id} /><input type="hidden" name="back" value={back} />
        <button className="monarch-link is-danger" data-confirm="Delete this note? This cannot be undone.">Delete</button>
      </form>
    </span>
  );
}
