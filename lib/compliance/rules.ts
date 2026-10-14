import type { Attestation, ComplianceItem, ComplianceSettings, Form8879, Incident } from "./types.ts";

// The Compliance Center's rules, kept pure so the pages, the reminder sweep and the tests share one definition.
// Guided, not caged: these rules decide what to warn about and when to remind. They never block an office.

const DAY = 86_400_000;

/** Today's date in Eastern time (the IRS calendar), as YYYY-MM-DD. */
export const todayIso = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);

const at = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((at(to) - at(from)) / DAY);
export const addDays = (day: string, n: number) => iso(at(day) + n * DAY);
/** Calendar months later; the 31st becomes the last day of a shorter month. */
export function addMonths(day: string, months: number): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)) - 1 + months;
  const d = Number(day.slice(8, 10));
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(Date.UTC(y, m, Math.min(d, last)));
}
export const addYears = (day: string, years: number) => addMonths(day, years * 12);
export const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(at(v)) && iso(at(v)) === v;

// ------------------------------------------------------------------ Form 8879

export const RETENTION_YEARS = 3;

/**
 * IRS Publication 1345: keep the signed 8879 for 3 years from the return's due date (with extensions) or the date the
 * IRS received the return, whichever is later. The database works out the same date (form_8879_retention).
 */
export function retentionUntil(dueDate: string, receivedDate: string | null): string {
  const from = receivedDate && receivedDate > dueDate ? receivedDate : dueDate;
  return addYears(from, RETENTION_YEARS);
}

export type RetentionState = "keep" | "ending" | "past";
/** "past": the retention period is over and the record can be disposed of (it is never deleted automatically). */
export function retentionState(retention: string, today: string, alertDays: number): RetentionState {
  if (today >= retention) return "past";
  return daysBetween(today, retention) <= alertDays ? "ending" : "keep";
}

/**
 * Whether deleting now is earlier than the IRS rule allows, and the warning to show. The 3 years run from the later of
 * the due date and the IRS received date, which is the retention end less 3 years.
 */
export function earlyDeletion(retention: string | null, today: string): { early: boolean; warning: string | null } {
  if (!retention || today >= retention) return { early: false, warning: null };
  return { early: true, warning: `Required by IRS: this record must be kept for 3 years from ${longDate(addYears(retention, -RETENTION_YEARS))}. Deleting it early is your decision.` };
}

export const longDate = (day: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(at(day)));

/**
 * The usual due date for an individual return of a tax year: April 15 of the next year, or October 15 with an
 * extension. Weekends and holidays move the real date; the office can change it on the record.
 */
export const defaultDueDate = (taxYear: number, extended: boolean) => `${taxYear + 1}-${extended ? "10" : "04"}-15`;

// ------------------------------------------------------------------ WISP review

export type ReviewState = { state: "none" | "current" | "due_soon" | "overdue"; due: string | null; days: number | null };
/** The office's WISP status from its latest attestation. "due_soon" starts at the longest reminder before the due date. */
export function reviewState(latest: Pick<Attestation, "review_due"> | null, today: string, reminderDays: number[]): ReviewState {
  if (!latest) return { state: "none", due: null, days: null };
  const days = daysBetween(today, latest.review_due);
  if (days < 0) return { state: "overdue", due: latest.review_due, days };
  const window = Math.max(0, ...reminderDays);
  return { state: days <= window ? "due_soon" : "current", due: latest.review_due, days };
}

/** The reminder stage due today, if any: the smallest reminder day that has been reached, or "overdue". */
export function reviewReminderStage(review: ReviewState, reminderDays: number[]): string | null {
  if (review.days === null) return null;
  if (review.days < 0) return "overdue";
  const reached = [...reminderDays].sort((a, b) => a - b).find((d) => review.days! <= d);
  return reached === undefined ? null : `d${reached}`;
}

export const nextReviewDue = (attestedOn: string, months: number) => addMonths(attestedOn, months);

// ------------------------------------------------------------------ PTIN

/**
 * Every PTIN expires December 31. Renewal season runs October 16 – December 31 and renews for the next year; the
 * rest of the year, "renewed for" means the current year.
 */
export function ptinSeason(today: string): { inSeason: boolean; renewalYear: number; seasonStart: string; seasonEnd: string } {
  const year = Number(today.slice(0, 4));
  const inSeason = today >= `${year}-10-16`;
  return { inSeason, renewalYear: inSeason ? year + 1 : year, seasonStart: `${year}-10-16`, seasonEnd: `${year}-12-31` };
}

/** Which reminder period today falls in, so a preparer who hasn't renewed gets one reminder per period. */
export function ptinReminderPeriod(today: string, everyDays: number): string | null {
  const s = ptinSeason(today);
  if (!s.inSeason) return null;
  return `${s.renewalYear}:${Math.floor(daysBetween(s.seasonStart, today) / Math.max(1, everyDays))}`;
}

// ------------------------------------------------------------------ incidents

export const FTC_THRESHOLD = 500;
export const FTC_DAYS = 30;
export const FTC_NOTICE = "Required by FTC: if unencrypted information of 500 or more people is involved, notify the FTC within 30 days of discovering it.";
export const LIAISON_URL = "https://www.irs.gov/businesses/small-businesses-self-employed/stakeholder-liaison-local-contacts";

/** Whether the FTC notice applies, and its deadline. "Unknown" encryption counts as unencrypted until confirmed. */
export function ftcDuty(incident: Pick<Incident, "people_affected" | "info_encrypted" | "discovered_on" | "ftc_notified_on">, today: string) {
  const applies = (incident.people_affected ?? 0) >= FTC_THRESHOLD && incident.info_encrypted !== "yes";
  const deadline = addDays(incident.discovered_on, FTC_DAYS);
  return { applies, deadline, done: Boolean(incident.ftc_notified_on), daysLeft: daysBetween(today, deadline), overdue: applies && !incident.ftc_notified_on && today > deadline };
}

export type IncidentStep = { key: string; title: string; detail: string; rule?: "IRS" | "FTC"; when?: "ftc" };
/** The checklist follows the incident response section of the shared WISP (lib/wisp/plan.ts). */
export const INCIDENT_STEPS: IncidentStep[] = [
  { key: "report", title: "Report it to the incident response contact", detail: "Write down when it was noticed and what was seen. Don't investigate alone and don't delete anything." },
  { key: "contain", title: "Contain it", detail: "Disconnect affected computers from the network but don't turn them off or wipe them. Change passwords from a clean device, confirm two-step sign-in, and remove access for any compromised account. Lock or wipe a lost device remotely if possible." },
  { key: "assess", title: "Assess what happened", detail: "Which systems and records were involved, how many people's information, and whether it was encrypted. Bring in IT or forensic help as needed and tell your cyber or liability insurer early." },
  { key: "irs", title: "Report to your IRS Stakeholder Liaison", detail: "Without delay, so the IRS can help protect your clients' accounts.", rule: "IRS" },
  { key: "ehelp", title: "Contact IRS e-Help if your EFIN or e-file credentials may be compromised", detail: "They can help secure your e-file account." },
  { key: "states", title: "Notify the state tax agencies", detail: "For the states where affected clients file, for example through the Federation of Tax Administrators at StateAlert@taxadmin.org." },
  { key: "ftc", title: "Notify the FTC", detail: FTC_NOTICE, rule: "FTC", when: "ftc" },
  { key: "state_law", title: "Follow each state's breach notification law", detail: "Some states require notice to affected clients and the state attorney general within set deadlines." },
  { key: "police", title: "Report theft or crime", detail: "To local police and, for cybercrime, the FBI's Internet Crime Complaint Center (ic3.gov)." },
  { key: "clients", title: "Tell affected clients", detail: "What happened, what information was involved, what you're doing, and what they can do: request an Identity Protection PIN, and file Form 14039 if they become identity theft victims." },
  { key: "recover", title: "Recover and review", detail: "Restore from known-good backups, review what happened, and update your risk assessment and your WISP." },
];

/** The steps not done or skipped yet. The FTC step only counts when the FTC rule applies. */
export function openSteps(incident: Pick<Incident, "steps" | "people_affected" | "info_encrypted" | "discovered_on" | "ftc_notified_on">, today: string) {
  const ftc = ftcDuty(incident, today);
  return INCIDENT_STEPS.filter((s) => !incident.steps[s.key] && (s.when !== "ftc" || ftc.applies));
}

// ------------------------------------------------------------------ office items

export type ItemState = { state: "done" | "open" | "due_soon" | "overdue"; due: string | null };
/** A one-time item is done once marked. A yearly item is done for its current cycle (the year before its due date). */
export function itemState(item: Pick<ComplianceItem, "repeat" | "due_on" | "done_at">, today: string, soonDays = 30): ItemState {
  const due = item.due_on;
  const doneDay = item.done_at ? todayIso(new Date(item.done_at)) : null;
  const done = item.repeat === "once" ? Boolean(doneDay) : Boolean(doneDay && (!due || doneDay > addYears(due, -1)));
  if (done) return { state: "done", due };
  if (!due) return { state: "open", due };
  const days = daysBetween(today, due);
  return { state: days < 0 ? "overdue" : days <= soonDays ? "due_soon" : "open", due };
}

/** After a yearly item is done, its next due date is a year later (from the due date, or today when it had none). */
export const nextYearlyDue = (due: string | null, today: string) => addYears(due ?? today, 1);

// ------------------------------------------------------------------ office status

export type Alert = { tone: "danger" | "warning" | "info"; title: string; detail: string; href: string };

export type OfficeStatus = {
  review: ReviewState;
  acks: { done: number; of: number };
  ptin: { inSeason: boolean; year: number; renewed: number; of: number };
  incidents: { open: number; ftcOverdue: number };
  records8879: { total: number; ending: number; past: number };
  items: { overdue: number; dueSoon: number };
};

/** The office's compliance status as alerts for the office dashboard, worst first. */
export function officeAlerts(s: OfficeStatus, base = "/office/compliance"): Alert[] {
  const out: Alert[] = [];
  if (s.incidents.ftcOverdue) out.push({ tone: "danger", title: "FTC notice past its deadline", detail: FTC_NOTICE, href: `${base}/incidents` });
  if (s.incidents.open) out.push({ tone: "warning", title: `${s.incidents.open} open incident${s.incidents.open === 1 ? "" : "s"}`, detail: "Work through the checklist and record each step.", href: `${base}/incidents` });
  if (s.review.state === "none") out.push({ tone: "warning", title: "No WISP attestation yet", detail: "Required by IRS (Publication 5708) and the FTC Safeguards Rule: keep a written information security plan. Build one or upload yours, then attest.", href: `${base}/wisp` });
  if (s.review.state === "overdue") out.push({ tone: "danger", title: "WISP review overdue", detail: `The annual review was due ${longDate(s.review.due!)}. Review the plan and attest again.`, href: `${base}/wisp` });
  if (s.review.state === "due_soon") out.push({ tone: "info", title: `WISP review due in ${s.review.days} day${s.review.days === 1 ? "" : "s"}`, detail: `Due ${longDate(s.review.due!)}.`, href: `${base}/wisp` });
  if (s.review.state !== "none" && s.acks.done < s.acks.of) out.push({ tone: "info", title: `${s.acks.of - s.acks.done} of ${s.acks.of} team members haven't acknowledged the WISP`, detail: "Each PTIN holder confirms they've read the office WISP.", href: `${base}/wisp` });
  if (s.ptin.inSeason && s.ptin.renewed < s.ptin.of) out.push({ tone: "warning", title: `${s.ptin.of - s.ptin.renewed} PTIN${s.ptin.of - s.ptin.renewed === 1 ? "" : "s"} not renewed for ${s.ptin.year}`, detail: "Every PTIN expires December 31. Renewal is open October 16 – December 31.", href: `${base}/ptin` });
  if (s.records8879.ending) out.push({ tone: "info", title: `${s.records8879.ending} Form 8879 record${s.records8879.ending === 1 ? "" : "s"} near the end of retention`, detail: "Review them before the retention period ends.", href: `${base}/8879?view=ending` });
  if (s.records8879.past) out.push({ tone: "info", title: `${s.records8879.past} Form 8879 record${s.records8879.past === 1 ? "" : "s"} past retention`, detail: "They can now be disposed of securely. Nothing is deleted automatically.", href: `${base}/8879?view=past` });
  if (s.items.overdue) out.push({ tone: "warning", title: `${s.items.overdue} office checklist item${s.items.overdue === 1 ? "" : "s"} overdue`, detail: "From your office's own compliance checklist.", href: `${base}/items` });
  if (s.items.dueSoon) out.push({ tone: "info", title: `${s.items.dueSoon} office checklist item${s.items.dueSoon === 1 ? "" : "s"} due soon`, detail: "Within 30 days.", href: `${base}/items` });
  return out;
}

export function settingsOf(s: ComplianceSettings | null): Pick<ComplianceSettings, "review_months" | "review_reminder_days" | "retention_alert_days" | "ptin_reminder_every_days"> {
  return {
    review_months: s?.review_months ?? 12,
    review_reminder_days: s?.review_reminder_days ?? [30, 7],
    retention_alert_days: s?.retention_alert_days ?? 90,
    ptin_reminder_every_days: s?.ptin_reminder_every_days ?? 14,
  };
}

export function count8879(records: Pick<Form8879, "retention_until">[], today: string, alertDays: number) {
  let ending = 0;
  let past = 0;
  for (const r of records) {
    const st = retentionState(r.retention_until, today, alertDays);
    if (st === "ending") ending++;
    if (st === "past") past++;
  }
  return { total: records.length, ending, past };
}
