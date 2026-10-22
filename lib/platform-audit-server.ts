import "server-only";
import { tenantClient, platformClient } from "./supabase/service";
import { PLATFORM_TENANT_ID } from "./tenants.ts";
import { cleanDetail, isPlatformAction, type PlatformAction } from "./platform-audit.ts";

export type PlatformActivity = { id: string; created_at: string; action: PlatformAction; actor_id: string | null; tenant_id: string; subject_type: string | null; detail: Record<string, string> };

/**
 * Records one platform-administrator action. `tenantId` is the workspace it targets; leave it out for a platform-wide action
 * (it is then recorded against Verexa HQ). A failure to write is reported to the log and never blocks the action itself,
 * which has already happened by the time it is recorded.
 */
export async function recordPlatformAction(
  actorId: string,
  action: PlatformAction,
  opts: { tenantId?: string; subjectType?: string; subjectId?: string; detail?: Record<string, unknown> } = {},
): Promise<void> {
  const tenantId = opts.tenantId ?? PLATFORM_TENANT_ID;
  const { error } = await tenantClient(tenantId).from("workspace_audit_events").insert({
    actor_id: actorId, action, subject_type: opts.subjectType ?? null, subject_id: opts.subjectId ?? null, detail: cleanDetail(opts.detail),
  });
  if (error) console.error(JSON.stringify({ event: "platform_audit_write_failed", action, message: error.message.slice(0, 160) }));
}

/** The most recent platform-administrator actions across every workspace and the platform itself. */
export async function recentPlatformActivity(limit = 100): Promise<PlatformActivity[]> {
  const { data, error } = await platformClient("platform_audit").from("workspace_audit_events").select("id, created_at, action, actor_id, tenant_id, subject_type, detail").like("action", "platform\\_%").order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; created_at: string; action: string; actor_id: string | null; tenant_id: string; subject_type: string | null; detail: Record<string, string> }[])
    .filter((r): r is typeof r & { action: PlatformAction } => isPlatformAction(r.action));
}
