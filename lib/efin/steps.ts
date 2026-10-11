import type { AssignmentRow, EfinRow, FilingRow, OrgRow, PersonRow } from "./types.ts";
import { tracksTeam } from "./rules.ts";

// "Next steps" for a firm, derived only from what is recorded. Nothing here says anything about IRS status.

export type Step = { key: string; label: string; done: boolean; tab: string };

export function nextSteps(d: { org: OrgRow; efin?: EfinRow; person?: PersonRow; assignments: AssignmentRow[]; filings: FilingRow[] }): Step[] {
  const { org, efin, person } = d;
  const steps: Step[] = [];
  if (!efin) return [{ key: "efin", label: "Record this firm's EFIN", done: false, tab: "filing" }];
  steps.push({ key: "verify", label: "Verify the EFIN and record how it was confirmed", done: efin.external_status !== "unverified", tab: "overview" });
  steps.push({ key: "renewal", label: "Record the renewal date and mark it verified", done: Boolean(efin.recorded_expiration && efin.expiration_verified), tab: "renewals" });
  steps.push({ key: "contact", label: "Add the contact's email and phone", done: Boolean(person?.email && person?.phone), tab: "overview" });
  if (tracksTeam(org.relationship)) {
    steps.push({ key: "assignment", label: "Submit and approve the ERO assignment", done: d.assignments.some((a) => a.efin_id === efin.id && a.role === "ero" && ["approved", "active"].includes(a.state)), tab: "filing" });
  }
  steps.push({ key: "filing", label: "Record the filing software provider", done: d.filings.some((f) => f.efin_id === efin.id && !f.archived_at), tab: "filing" });
  return steps;
}
