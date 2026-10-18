import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { rotate, runTick, type TickJob } from "../lib/scheduler/tick.ts";

// The five-minute tick: every tenant, every job, isolated from each other's failures, bounded in time.

describe("runTick", () => {
  test("runs every job for every tenant and totals what each did", async () => {
    const seen: string[] = [];
    const jobs: TickJob[] = [
      { name: "a", run: async (t) => { seen.push(`a:${t}`); return 2; } },
      { name: "b", run: async (t) => { seen.push(`b:${t}`); return 1; } },
    ];
    const r = await runTick(["t1", "t2"], jobs);
    assert.deepEqual(seen, ["a:t1", "b:t1", "a:t2", "b:t2"]);
    assert.deepEqual(r, { tenants: 2, jobs: { a: 4, b: 2 }, failed: [], stoppedEarly: false });
  });
  test("one tenant's or one job's failure never stops the rest", async () => {
    const logs: string[] = [];
    const jobs: TickJob[] = [
      { name: "a", run: async (t) => { if (t === "t1") throw new Error("boom"); return 1; } },
      { name: "b", run: async () => 1 },
    ];
    const r = await runTick(["t1", "t2"], jobs, { log: (l) => logs.push(l) });
    assert.deepEqual(r.failed, [{ tenant: "t1", job: "a" }]);
    assert.deepEqual(r.jobs, { a: 1, b: 2 });
    assert.equal(logs.length, 1);
  });
  test("stops starting new tenants once the time budget is spent, and says so", async () => {
    let t = 0;
    const jobs: TickJob[] = [{ name: "a", run: async () => { t += 30_000; return 1; } }];
    const r = await runTick(["t1", "t2", "t3", "t4"], jobs, { budgetMs: 50_000, now: () => t });
    assert.equal(r.tenants, 2);
    assert.equal(r.stoppedEarly, true);
  });
  test("a rotating start means skipped tenants go first next time", () => {
    assert.deepEqual(rotate(["a", "b", "c"], 0), ["a", "b", "c"]);
    assert.deepEqual(rotate(["a", "b", "c"], 1), ["b", "c", "a"]);
    assert.deepEqual(rotate(["a", "b", "c"], 4), ["b", "c", "a"]);
    assert.deepEqual(rotate(["a"], 7), ["a"]);
    assert.deepEqual(rotate([], 3), []);
  });
});

describe("the tick is wired up", () => {
  const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  test("it runs every five minutes, is reachable without a session, and needs the cron secret", () => {
    assert.match(src("vercel.json"), /"\/api\/automation\/tick"[\s\S]*"\*\/5 \* \* \* \*"/);
    assert.match(src("lib/supabase/proxy.ts"), /"\/api\/automation\/tick"/);
    const route = src("app/api/automation/tick/route.ts");
    assert.match(route, /CRON_SECRET/);
    assert.match(route, /status|new Response\("Unauthorized", \{ status: 401 \}\)/);
  });
  test("the daily sweeps stay on the daily schedule", () => {
    assert.match(src("vercel.json"), /"\/api\/automation\/run"[\s\S]*"0 11 \* \* \*"/);
  });
});
