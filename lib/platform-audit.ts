// What the platform administrators' audit trail records. Pure, so it can be tested; the database part is in
// platform-audit-server.ts. Entries go in workspace_audit_events: against the workspace the action targets, or against
// Verexa HQ (the platform's own record) when the action targets no workspace.

/** Every platform action that is recorded. The prefix lets the activity page find them among a workspace's own entries. */
export const PLATFORM_ACTIONS = [
  "platform_workspace_created",
  "platform_invite_resent",
  "platform_access_changed",
  "platform_billing_setup_run",
] as const;
export type PlatformAction = (typeof PLATFORM_ACTIONS)[number];

export const isPlatformAction = (v: string): v is PlatformAction => (PLATFORM_ACTIONS as readonly string[]).includes(v);

/** Words for the activity page. */
export const PLATFORM_ACTION_LABEL: Record<PlatformAction, string> = {
  platform_workspace_created: "Workspace created",
  platform_invite_resent: "Invite re-sent",
  platform_access_changed: "Access changed",
  platform_billing_setup_run: "Billing setup run",
};

/** A short, safe detail object: strings only, trimmed, no more than a few keys (nothing secret is ever passed in). */
export function cleanDetail(detail: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(detail ?? {}).slice(0, 8)) {
    if (/key|secret|token|password/i.test(k)) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k.slice(0, 40)] = String(v).slice(0, 200);
  }
  return out;
}
