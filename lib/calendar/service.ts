import { ValidationError } from "../commerce/validation.ts";
import {
  BusinessInputError, checkClosure, checkWeek, DEFAULT_TIME_ZONE, DEFAULT_WEEK, federalHolidays, isTimeZone, parseYmd,
  type BusinessCalendar, type Week,
} from "./business.ts";

// Loading and editing an office's business calendar. The time zone is the firm profile's; the weekly hours and the
// closures are the office's own rows.

export type ClosureRow = {
  id: string; source: "federal" | "custom"; holiday_key: string | null; holiday_year: number | null; name: string;
  start_date: string; end_date: string; enabled: boolean;
};
export type NewClosure = Omit<ClosureRow, "id">;

export interface BusinessRepo {
  getWeek(): Promise<Week | null>;
  saveWeek(week: Week): Promise<void>;
  listClosures(): Promise<ClosureRow[]>;
  insertClosures(rows: NewClosure[]): Promise<void>;
  getClosure(id: string): Promise<ClosureRow | null>;
  updateClosure(id: string, patch: Partial<Pick<ClosureRow, "name" | "start_date" | "end_date" | "enabled">>): Promise<void>;
  deleteClosure(id: string): Promise<void>;
}
export type BusinessDeps = { repo: BusinessRepo; timeZone: () => Promise<string | null>; now?: () => Date };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asInput = (e: unknown) => (e instanceof BusinessInputError ? new ValidationError(e.message) : e);
export const HOLIDAY_YEARS_AHEAD = 2;

/** Writes the federal holidays for this year and the next two that the office doesn't have yet. Never touches existing rows. */
export async function ensureHolidays(deps: BusinessDeps): Promise<number> {
  const year = (deps.now ? deps.now() : new Date()).getUTCFullYear();
  const have = new Set((await deps.repo.listClosures()).filter((c) => c.holiday_key).map((c) => `${c.holiday_key}:${c.holiday_year}`));
  const rows: NewClosure[] = [];
  for (let y = year; y <= year + HOLIDAY_YEARS_AHEAD; y++) {
    for (const h of federalHolidays(y)) {
      if (!have.has(`${h.key}:${y}`)) rows.push({ source: "federal", holiday_key: h.key, holiday_year: y, name: h.name, start_date: h.date, end_date: h.date, enabled: true });
    }
  }
  if (rows.length) await deps.repo.insertClosures(rows);
  return rows.length;
}

export async function loadCalendar(deps: BusinessDeps): Promise<BusinessCalendar> {
  await ensureHolidays(deps).catch(() => 0); // a failure here never stops a calendar from loading
  const [week, closures, tz] = await Promise.all([deps.repo.getWeek(), deps.repo.listClosures(), deps.timeZone()]);
  return {
    timeZone: tz && isTimeZone(tz) ? tz : DEFAULT_TIME_ZONE,
    week: week ?? DEFAULT_WEEK,
    closures: closures.map((c) => ({ start: c.start_date, end: c.end_date, enabled: c.enabled })),
  };
}

export async function saveHours(deps: BusinessDeps, raw: unknown): Promise<Week> {
  let week: Week;
  try { week = checkWeek(raw); } catch (e) { throw asInput(e); }
  await deps.repo.saveWeek(week);
  return week;
}

export async function addClosure(deps: BusinessDeps, raw: { name?: unknown; start?: unknown; end?: unknown }): Promise<void> {
  let c;
  try { c = checkClosure(raw); } catch (e) { throw asInput(e); }
  if ((await deps.repo.listClosures()).filter((x) => x.source === "custom").length >= 200) throw new ValidationError("An office can have up to 200 closures of its own. Remove old ones first.");
  await deps.repo.insertClosures([{ source: "custom", holiday_key: null, holiday_year: null, name: c.name, start_date: c.start, end_date: c.end, enabled: true }]);
}

/** Changes a closure's name and dates (federal holidays included: that is how Christmas becomes December 23 to 26). */
export async function editClosure(deps: BusinessDeps, id: string, raw: { name?: unknown; start?: unknown; end?: unknown }): Promise<void> {
  const row = UUID.test(id) ? await deps.repo.getClosure(id) : null;
  if (!row) throw new ValidationError("That closure wasn't found.");
  let c;
  try { c = checkClosure(raw); } catch (e) { throw asInput(e); }
  await deps.repo.updateClosure(row.id, { name: c.name, start_date: c.start, end_date: c.end });
}

export async function setClosureEnabled(deps: BusinessDeps, id: string, enabled: boolean): Promise<void> {
  const row = UUID.test(id) ? await deps.repo.getClosure(id) : null;
  if (!row) throw new ValidationError("That closure wasn't found.");
  await deps.repo.updateClosure(row.id, { enabled });
}

/** Federal holidays are switched off, never deleted (they would be written again); the office's own closures can be removed. */
export async function removeClosure(deps: BusinessDeps, id: string): Promise<void> {
  const row = UUID.test(id) ? await deps.repo.getClosure(id) : null;
  if (!row) throw new ValidationError("That closure wasn't found.");
  if (row.source === "federal") throw new ValidationError("A federal holiday can be switched off, not removed.");
  await deps.repo.deleteClosure(row.id);
}

export { parseYmd };
