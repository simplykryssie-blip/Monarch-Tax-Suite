import { LEAD_STATUSES, sourceName, type LeadSource, type LeadStatus } from "@/lib/leads/types.ts";

// Small pieces shared by the Leads pages.

const STATUS_CLASS: Record<LeadStatus, string> = { new: "pending", interested: "active", converted: "paid", lost: "inactive" };

export function StatusBadge({ status }: { status: LeadStatus }) {
  return <span className={`monarch-badge ${STATUS_CLASS[status]}`}>{LEAD_STATUSES[status]}</span>;
}

export const sourceLabel = (s: LeadSource) => sourceName(s);

/** A date for the list (no time). */
export function day(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/New_York" }).format(new Date(iso));
}

/** A timestamp as YYYY-MM-DD for a date input. */
export const dateValue = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso)) : "");

/** Turns a missing-table error into a setup notice instead of a crash. */
export async function leadsLoad<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (/relation|schema cache|does not exist/i.test(m)) return { ok: false, message: m.slice(0, 200) };
    throw e;
  }
}

// The message is kept for logs only; people are told to contact support.
/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
export function LeadsSetupRequired({ message: _message }: { message: string }) {
  return (
    <div className="monarch-notice">
      <b>NOT SET UP YET</b> This part of your account isn&apos;t ready yet. Please contact support and we&apos;ll finish setting it up. Nothing else is affected. 
    </div>
  );
}
