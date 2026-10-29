import { FormattedInput } from "@/components/forms/formatted-input";
import { TagInput } from "./tag-input";
import { LEAD_STATUSES, STATUS_KEYS } from "@/lib/leads/types.ts";

// The lead's editable fields, shared by the add form and the lead's page.

export type LeadValues = Partial<Record<"full_name" | "email" | "phone" | "firm_name" | "source" | "status" | "notes" | "tags" | "last_contacted_at", string>>;

/** `showSource`: the source is set automatically when a lead arrives; it is only shown (and editable) on an existing lead. */
export function LeadFields({ v, tagOptions = [], showSource = false }: { v: LeadValues; tagOptions?: string[]; showSource?: boolean }) {
  return (
    <>
      <label>Name *<input name="full_name" required maxLength={200} defaultValue={v.full_name ?? ""} autoComplete="off" /></label>
      <label>Email *<input name="email" type="email" required maxLength={254} defaultValue={v.email ?? ""} autoComplete="off" /></label>
      <label>Phone<FormattedInput kind="phone" name="phone" defaultValue={v.phone ?? ""} autoComplete="off" /></label>
      <label>Firm name<input name="firm_name" maxLength={200} defaultValue={v.firm_name ?? ""} autoComplete="off" /></label>
      <div className="is-wide field-block"><span className="field-label">Tags</span><TagInput initial={(v.tags ?? "").split(",").filter(Boolean)} suggestions={tagOptions} /></div>
      {showSource ? <label>Source<input name="source" maxLength={120} defaultValue={v.source ?? ""} autoComplete="off" /><small className="monarch-muted">Set automatically; change it if it&apos;s wrong.</small></label> : <input type="hidden" name="source" value="manual" />}
      <label>Status
        <select name="status" defaultValue={v.status ?? "new"}>
          {STATUS_KEYS.filter((s) => s !== "converted" || v.status === "converted").map((s) => <option key={s} value={s}>{LEAD_STATUSES[s]}</option>)}
        </select>
      </label>
      <label>Last contacted<input name="last_contacted_at" type="date" defaultValue={v.last_contacted_at ?? ""} /></label>
      <label className="is-wide">Notes<textarea name="notes" rows={5} maxLength={10000} defaultValue={v.notes ?? ""} /></label>
    </>
  );
}
