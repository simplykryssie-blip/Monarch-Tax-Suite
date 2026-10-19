import assert from "node:assert/strict";
import test from "node:test";
import { addClosure, editClosure, ensureHolidays, loadCalendar, removeClosure, saveHours, setClosureEnabled, type BusinessDeps, type BusinessRepo, type ClosureRow, type NewClosure } from "../lib/calendar/service.ts";
import { DEFAULT_WEEK, type Week } from "../lib/calendar/business.ts";
import { ValidationError } from "../lib/commerce/validation.ts";

class Memory implements BusinessRepo {
  week: Week | null = null;
  rows: ClosureRow[] = [];
  n = 0;
  async getWeek() { return this.week; }
  async saveWeek(w: Week) { this.week = w; }
  async listClosures() { return this.rows.map((r) => ({ ...r })); }
  async insertClosures(rows: NewClosure[]) { for (const r of rows) this.rows.push({ ...r, id: `00000000-0000-4000-8000-${String(++this.n).padStart(12, "0")}` }); }
  async getClosure(id: string) { return this.rows.find((r) => r.id === id) ?? null; }
  async updateClosure(id: string, patch: Partial<ClosureRow>) { Object.assign(this.rows.find((r) => r.id === id)!, patch); }
  async deleteClosure(id: string) { this.rows = this.rows.filter((r) => r.id !== id); }
}
const make = (tz: string | null = "America/Chicago") => {
  const repo = new Memory();
  const deps: BusinessDeps = { repo, timeZone: async () => tz, now: () => new Date("2026-10-17T12:00:00Z") };
  return { repo, deps };
};

test("holidays are written for this year and the next two, once", async () => {
  const { repo, deps } = make();
  const first = await ensureHolidays(deps);
  assert.equal(first, 33);
  assert.equal(await ensureHolidays(deps), 0);
  assert.ok(repo.rows.every((r) => r.source === "federal" && r.enabled));
  assert.deepEqual([...new Set(repo.rows.map((r) => r.holiday_year))].sort(), [2026, 2027, 2028]);
});

test("an office's edits to a holiday survive the next top-up", async () => {
  const { repo, deps } = make();
  await ensureHolidays(deps);
  const xmas = repo.rows.find((r) => r.holiday_key === "christmas" && r.holiday_year === 2026)!;
  await editClosure(deps, xmas.id, { name: "Christmas break", start: "2026-12-23", end: "2026-12-26" });
  await setClosureEnabled(deps, repo.rows[0].id, false);
  await ensureHolidays(deps);
  assert.equal(repo.rows.length, 33);
  assert.equal(repo.rows.find((r) => r.id === xmas.id)!.end_date, "2026-12-26");
  assert.equal(repo.rows[0].enabled, false);
});

test("loadCalendar uses the firm time zone, falling back when it is missing or invalid", async () => {
  assert.equal((await loadCalendar(make("America/Denver").deps)).timeZone, "America/Denver");
  assert.equal((await loadCalendar(make(null).deps)).timeZone, "America/New_York");
  assert.equal((await loadCalendar(make("Mars/Base").deps)).timeZone, "America/New_York");
});

test("loadCalendar defaults to Monday to Friday, 9 to 5, and uses saved hours", async () => {
  const { deps } = make();
  assert.deepEqual((await loadCalendar(deps)).week, DEFAULT_WEEK);
  const week = { ...DEFAULT_WEEK, 6: { open: "10:00", close: "14:00" } } as Week;
  await saveHours(deps, week);
  assert.deepEqual((await loadCalendar(deps)).week[6], { open: "10:00", close: "14:00" });
});

test("bad hours are rejected as input errors", async () => {
  const { deps } = make();
  await assert.rejects(saveHours(deps, { ...DEFAULT_WEEK, 1: { open: "17:00", close: "09:00" } }), ValidationError);
});

test("custom closures can be added, edited and removed; federal ones only switched off", async () => {
  const { repo, deps } = make();
  await ensureHolidays(deps);
  await addClosure(deps, { name: "Retreat", start: "2026-11-02", end: "2026-11-03" });
  const custom = repo.rows.find((r) => r.source === "custom")!;
  assert.equal(custom.enabled, true);
  await editClosure(deps, custom.id, { name: "Retreat", start: "2026-11-02", end: "2026-11-04" });
  assert.equal(repo.rows.find((r) => r.id === custom.id)!.end_date, "2026-11-04");
  await removeClosure(deps, custom.id);
  assert.equal(repo.rows.some((r) => r.id === custom.id), false);
  await assert.rejects(removeClosure(deps, repo.rows[0].id), ValidationError);
  await assert.rejects(removeClosure(deps, "not-an-id"), ValidationError);
});

test("a closure that ends before it starts is refused", async () => {
  const { deps } = make();
  await assert.rejects(addClosure(deps, { name: "Bad", start: "2026-11-05", end: "2026-11-01" }), ValidationError);
});
