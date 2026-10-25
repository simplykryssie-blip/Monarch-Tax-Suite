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

export type DueTask = { id: string; title: string; due_on: string; clientId: string | null; clientName: string; source: "workflow" | "client" };

/** Open tasks with a due date inside [from, to): the client's own and those a workflow made, for the Calendar. */
export async function tasksDueBetween(from: string, to: string): Promise<DueTask[]> {
  const { workspaceRepo } = await import("./server");
  const repo = workspaceRepo();
  const [own, clients, auto] = await Promise.all([
    repo.listTasks({ openOnly: true }).catch(() => []),
    repo.listClients({ includeArchived: true }).catch(() => []),
    tenantClient(currentTenantId()).from("automation_tasks").select("id, title, due_on, contact_name, client_id").is("done_at", null).gte("due_on", from).lt("due_on", to).limit(500).then((r) => r.data ?? []),
  ]);
  const name = new Map(clients.map((c) => [c.id, c.full_name]));
  const inRange = (d: string | null): d is string => Boolean(d && d >= from && d < to);
  return [
    ...own.filter((t) => inRange(t.due_on)).map((t): DueTask => ({ id: t.id, title: t.title, due_on: t.due_on!, clientId: t.client_id, clientName: name.get(t.client_id) ?? "Client", source: "client" })),
    ...auto.filter((t) => inRange(t.due_on)).map((t): DueTask => ({ id: t.id, title: t.title, due_on: t.due_on!, clientId: t.client_id, clientName: (t.client_id && name.get(t.client_id)) || t.contact_name || "Contact", source: "workflow" })),
  ].sort((a, b) => a.due_on.localeCompare(b.due_on) || a.title.localeCompare(b.title));
}

export type OpenTask = { id: string; title: string; due_on: string | null; clientId: string | null; clientName: string; source: "workflow" | "client" };

/** Every open task, the client's own and those a workflow made: soonest due first, undated last. For the Calendar's task list. */
export async function openTasks(limit = 100): Promise<OpenTask[]> {
  const { workspaceRepo } = await import("./server");
  const repo = workspaceRepo();
  const [own, clients, auto] = await Promise.all([
    repo.listTasks({ openOnly: true }).catch(() => []),
    repo.listClients({ includeArchived: true }).catch(() => []),
    tenantClient(currentTenantId()).from("automation_tasks").select("id, title, due_on, contact_name, client_id").is("done_at", null).limit(500).then((r) => r.data ?? [], () => []),
  ]);
  const name = new Map(clients.map((c) => [c.id, c.full_name]));
  const all: OpenTask[] = [
    ...own.map((t): OpenTask => ({ id: t.id, title: t.title, due_on: t.due_on, clientId: t.client_id, clientName: name.get(t.client_id) ?? "Client", source: "client" })),
    ...auto.map((t): OpenTask => ({ id: t.id, title: t.title, due_on: t.due_on, clientId: t.client_id, clientName: (t.client_id && name.get(t.client_id)) || t.contact_name || "Contact", source: "workflow" })),
  ];
  return all.sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999") || a.title.localeCompare(b.title)).slice(0, limit);
}
