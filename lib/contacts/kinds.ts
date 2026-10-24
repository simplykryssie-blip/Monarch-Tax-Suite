import { allows, type Tier } from "../tier.ts";

export type NewContactKind = "client" | "lead" | "customer";

/** What the one Add button can create on this plan: a client always, a lead where the plan has Leads, a customer where it has the store. */
export function contactKinds(tier: Tier): NewContactKind[] {
  return ["client", ...(allows(tier, "leads") ? (["lead"] as const) : []), ...(allows(tier, "store") ? (["customer"] as const) : [])];
}
