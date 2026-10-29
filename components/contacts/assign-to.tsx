import { assignContactAction } from "@/app/(admin)/contacts/assign-actions";
import type { StaffMember } from "@/lib/staff/assign.ts";

/** "Assigned to": one teammate responsible for this contact. Saved with its own button; a person off the team can't be chosen. */
export function AssignTo({ kind, id, current, staff, back }: { kind: "client" | "lead"; id: string; current: string | null; staff: StaffMember[]; back: string }) {
  const known = current && staff.some((s) => s.id === current);
  return (
    <form action={assignContactAction} className="cl-assign">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="back" value={back} />
      <label htmlFor={`assign-${id}`}><b>Assigned to</b></label>
      <select id={`assign-${id}`} name="assignee" defaultValue={known ? current! : ""}>
        <option value="">No one</option>
        {staff.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <button className="monarch-secondary">Save</button>
      {current && !known && <small className="monarch-muted">Currently a former teammate. Choose someone to reassign.</small>}
    </form>
  );
}
