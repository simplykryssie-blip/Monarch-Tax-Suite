import "server-only";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import type { ClientTask } from "./types.ts";

/** A task a workflow made for a client, shaped like the client's own tasks so the two show as one list. */
export type WorkflowTask = ClientTask & { source: "workflow" };

export async function workflowTasksFor(clientId: string): Promise<WorkflowTask[]> {
  const { data, error } = await tenantClient(currentTenantId()).from("automation_tasks").select("id, title, due_on, done_at, created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(200);
  if (error) return [];
  return (data ?? []).map((t) => ({ id: t.id, tenant_id: "", client_id: clientId, return_id: null, title: t.title, due_on: t.due_on, done_at: t.done_at, created_by: null, created_at: t.created_at, source: "workflow" }) as WorkflowTask);
}

export async function setWorkflowTaskDone(id: string, done: boolean): Promise<void> {
  const { error } = await tenantClient(currentTenantId()).from("automation_tasks").update({ done_at: done ? new Date().toISOString() : null }).eq("id", id);
  if (error) throw new Error(error.message);
}
