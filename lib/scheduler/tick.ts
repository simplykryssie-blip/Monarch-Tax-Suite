// The five-minute scheduler tick. The daily endpoint (/api/automation/run) keeps the slow, once-a-day sweeps; this
// one carries the work that has to be on time: workflow steps that are due (retries now, waits and branches from
// Phase 5b), and later appointment reminders. Every tenant is handled on its own, so one tenant's failure or slow
// work never stops another's, and a crash in one job never stops the next.

export type TickJob = { name: string; run: (tenantId: string) => Promise<number> };
export type TickReport = { tenants: number; jobs: Record<string, number>; failed: { tenant: string; job: string }[]; stoppedEarly: boolean };

/** Runs every job for every tenant, until `budgetMs` is spent (the platform kills a function that runs too long). */
export async function runTick(
  tenantIds: string[], jobs: TickJob[], opts: { budgetMs?: number; now?: () => number; log?: (line: string) => void } = {},
): Promise<TickReport> {
  const now = opts.now ?? Date.now;
  const started = now();
  const budget = opts.budgetMs ?? 50_000;
  const report: TickReport = { tenants: 0, jobs: {}, failed: [], stoppedEarly: false };
  for (const tenant of tenantIds) {
    if (now() - started > budget) { report.stoppedEarly = true; break; }
    report.tenants++;
    for (const job of jobs) {
      try {
        report.jobs[job.name] = (report.jobs[job.name] ?? 0) + (await job.run(tenant));
      } catch (e) {
        report.failed.push({ tenant, job: job.name });
        opts.log?.(`tick: ${job.name} failed for a tenant: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
      }
    }
  }
  return report;
}

/**
 * Tenants are visited in a rotating order so that, when the time budget runs out, the ones skipped this time go
 * first next time. `slot` is the 5-minute slot number (minutes since the epoch divided by five).
 */
export function rotate<T>(items: T[], slot: number): T[] {
  if (items.length < 2) return items;
  const k = ((slot % items.length) + items.length) % items.length;
  return [...items.slice(k), ...items.slice(0, k)];
}
