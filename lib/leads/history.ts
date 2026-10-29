import { LEAD_STATUSES, type LeadEvent, type LeadStatus } from "./types.ts";

const status = (v: unknown) => (typeof v === "string" && v in LEAD_STATUSES ? LEAD_STATUSES[v as LeadStatus] : String(v ?? ""));

/** One plain line for an entry in a lead's history. Unknown kinds still read sensibly. */
export function describeLeadEvent(e: Pick<LeadEvent, "action" | "detail">): string {
  const d = e.detail ?? {};
  switch (e.action) {
    case "created": return "Lead added";
    case "status_changed": return `Status changed from ${status(d.from)} to ${status(d.to)}`;
    case "contacted": return "Marked contacted";
    case "assigned": return `Assigned to ${typeof d.to === "string" ? d.to : "someone"}`;
    case "edited": return Array.isArray(d.fields) && d.fields.length ? `Edited ${d.fields.join(", ")}` : "Edited";
    case "merged": return `Merged with ${typeof d.from === "string" ? d.from : "another lead"}`;
    case "merged_into": return `Merged into ${typeof d.into === "string" ? d.into : "another lead"}`;
    case "converted_to_client": return "Converted to a client";
    default: return e.action.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  }
}
