// Sending health. There is no fixed cap on how much an office sends. Instead the office's own recent results decide:
// an office whose mail bounces or is reported as spam gets slowed, then stopped, automatically; a good sender is never
// limited. The thresholds follow what mailbox providers publish (complaints under 0.1%, bounces under a few percent).

export type SendStats = { sent: number; bounced: number; complained: number };
export type HealthLevel = "ok" | "throttled" | "paused";
export type Health = { level: HealthLevel; bounceRate: number; complaintRate: number; reason: string | null; sample: number };

/** Fewer sends than this and the rates mean little, so nothing is limited yet. */
export const MIN_SAMPLE = 100;
export const THROTTLE = { bounce: 0.03, complaint: 0.001 };
export const PAUSE = { bounce: 0.08, complaint: 0.003 };
/** How much of the normal batch size a throttled office sends each tick. */
export const THROTTLE_FACTOR = 0.2;

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

export function healthOf(stats: SendStats): Health {
  const sample = stats.sent;
  const bounceRate = sample ? stats.bounced / sample : 0;
  const complaintRate = sample ? stats.complained / sample : 0;
  if (sample < MIN_SAMPLE) return { level: "ok", bounceRate, complaintRate, reason: null, sample };
  if (complaintRate >= PAUSE.complaint) return { level: "paused", bounceRate, complaintRate, sample, reason: `Spam complaints are ${pct(complaintRate)} of recent sends (the limit is ${pct(PAUSE.complaint)}).` };
  if (bounceRate >= PAUSE.bounce) return { level: "paused", bounceRate, complaintRate, sample, reason: `${pct(bounceRate)} of recent emails bounced (the limit is ${pct(PAUSE.bounce)}). Clean your list before sending again.` };
  if (complaintRate >= THROTTLE.complaint) return { level: "throttled", bounceRate, complaintRate, sample, reason: `Spam complaints are ${pct(complaintRate)} of recent sends, so sending is slowed.` };
  if (bounceRate >= THROTTLE.bounce) return { level: "throttled", bounceRate, complaintRate, sample, reason: `${pct(bounceRate)} of recent emails bounced, so sending is slowed.` };
  return { level: "ok", bounceRate, complaintRate, reason: null, sample };
}

/** How many to send this tick, given the normal batch. */
export function batchFor(level: HealthLevel, normal: number): number {
  return level === "paused" ? 0 : level === "throttled" ? Math.max(1, Math.floor(normal * THROTTLE_FACTOR)) : normal;
}
