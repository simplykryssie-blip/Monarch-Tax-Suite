import "server-only";
import { tenantClient } from "./supabase/service";
import { SECURITY_ACTIONS, isSecurityAction, type SecurityAction } from "./security-audit-actions.ts";

// Changes to how people sign in are written to the workspace's own history (workspace_audit_events: append-only, one
// workspace can't see another's), so they show in Settings → Activity log. A failed write is logged and never blocks the change.

export async function recordSecurityEvent(tenantId: string, actorId: string, action: SecurityAction): Promise<void> {
  const { error } = await tenantClient(tenantId).from("workspace_audit_events").insert({ actor_id: actorId, action, subject_type: "user", subject_id: actorId, detail: {} });
  if (error) console.error(JSON.stringify({ event: "security_audit_write_failed", action, message: error.message.slice(0, 160) }));
}

export type SecurityEvent = { id: string; at: string; actorId: string | null; action: SecurityAction };

export async function recentSecurityEvents(tenantId: string, limit = 200): Promise<SecurityEvent[]> {
  const { data, error } = await tenantClient(tenantId).from("workspace_audit_events").select("id, created_at, actor_id, action").like("action", "security\\_%").order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; created_at: string; actor_id: string | null; action: string }[])
    .filter((r): r is typeof r & { action: SecurityAction } => isSecurityAction(r.action))
    .map((r) => ({ id: r.id, at: r.created_at, actorId: r.actor_id, action: r.action }));
}

export { SECURITY_ACTIONS };
