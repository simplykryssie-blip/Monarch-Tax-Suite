import { ValidationError } from "../commerce/validation.ts";

// Who on the team a contact is assigned to. A contact is assigned to one person who works in the same workspace, or to no one.

export type StaffMember = { id: string; label: string; role: "owner" | "admin" | "staff" };
export type Assignee = { id: string; label: string } | null;

/** The person chosen on a form (an empty choice means "no one"). Only someone on the team can be chosen. */
export function checkAssignee(staff: StaffMember[], raw: unknown): Assignee {
  const id = typeof raw === "string" ? raw.trim() : "";
  if (!id) return null;
  const person = staff.find((s) => s.id === id);
  if (!person) throw new ValidationError("That person isn't on your team.");
  return { id: person.id, label: person.label };
}

export const staffLabel = (staff: StaffMember[], id: string | null | undefined): string | null => (id ? staff.find((s) => s.id === id)?.label ?? "A former teammate" : null);

/**
 * Whether leads can be assigned to a teammate. Clients are assigned through their existing owner field. Leads need an
 * "assigned to" field in the database that is not installed in production yet, so this stays false until that change is
 * approved and applied there (supabase/migrations/20261128090000_leads_assigned_to.sql).
 */
export const LEAD_ASSIGNMENT_INSTALLED = false;
