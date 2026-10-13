import { LEAD_SOURCES, LEAD_STATUSES, SOURCE_KEYS, STATUS_KEYS } from "@/lib/leads/types.ts";

// The lead's editable fields, shared by the add form and the lead's page.

export type LeadValues = Partial<Record<"full_name" | "email" | "phone" | "firm_name" | "source" | "status" | "notes" | "last_contacted_at", string>>;

export function LeadFields({ v }: { v: LeadValues }) {
  return (
    <>
      <label>Name *<input name="full_name" required maxLength={200} defaultValue={v.full_name ?? ""} autoComplete="off" /></label>
      <label>Email *<input name="email" type="email" required maxLength={254} defaultValue={v.email ?? ""} autoComplete="off" /></label>
      <label>Phone<input name="phone" type="tel" maxLength={40} defaultValue={v.phone ?? ""} autoComplete="off" /></label>
      <label>Firm name<input name="firm_name" maxLength={200} defaultValue={v.firm_name ?? ""} autoComplete="off" /></label>
      <label>Source *
        <select name="source" required defaultValue={v.source ?? "manual"}>
          {SOURCE_KEYS.map((s) => <option key={s} value={s}>{LEAD_SOURCES[s]}</option>)}
        </select>
      </label>
      <label>Status
        <select name="status" defaultValue={v.status ?? "new"}>
          {STATUS_KEYS.map((s) => <option key={s} value={s}>{LEAD_STATUSES[s]}</option>)}
        </select>
      </label>
      <label>Last contacted<input name="last_contacted_at" type="date" defaultValue={v.last_contacted_at ?? ""} /></label>
      <label className="is-wide">Notes<textarea name="notes" rows={5} maxLength={10000} defaultValue={v.notes ?? ""} /></label>
    </>
  );
}
