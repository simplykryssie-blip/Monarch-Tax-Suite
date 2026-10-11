import { daysUntil } from "./rules.ts";
import type { EfinRow } from "./types.ts";

// Dashboard numbers derived only from what is recorded. There are deliberately no return counts, acceptance rates or
// "IRS status" figures: Monarch has no verified source for them.

export type StatusBucket = "active" | "expiring" | "review" | "pending" | "inactive";
export const BUCKET_LABEL: Record<StatusBucket, string> = { active: "Active", expiring: "Expiring within 60 days", review: "Needs review", pending: "Pending verification", inactive: "Inactive or suspended" };
export const EXPIRING_WINDOW_DAYS = 60;

export function bucketFor(e: Pick<EfinRow, "internal_status" | "recorded_expiration" | "expiration_verified">, today: string): StatusBucket {
  if (e.internal_status === "inactive" || e.internal_status === "suspended") return "inactive";
  if (e.internal_status === "draft" || e.internal_status === "pending_verification") return "pending";
  const left = e.recorded_expiration && e.expiration_verified ? daysUntil(e.recorded_expiration, today) : null;
  if (e.internal_status === "renewal_review" || (left !== null && left < 0)) return "review";
  if (left !== null && left <= EXPIRING_WINDOW_DAYS) return "expiring";
  return "active";
}

export function statusBreakdown(efins: Pick<EfinRow, "internal_status" | "recorded_expiration" | "expiration_verified" | "archived_at">[], today: string): Record<StatusBucket, number> {
  const out: Record<StatusBucket, number> = { active: 0, expiring: 0, review: 0, pending: 0, inactive: 0 };
  for (const e of efins) if (!e.archived_at) out[bucketFor(e, today)]++;
  return out;
}
