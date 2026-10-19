import Link from "next/link";
import { Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { tenantClient } from "@/lib/supabase/service";
import { currentTenantId } from "@/lib/tenants.ts";
import { completeTaskAction, reopenTaskAction } from "../actions";

type Task = { id: string; title: string; due_on: string | null; done_at: string | null; contact_name: string | null; contact_email: string | null; lead_id: string | null; client_id: string | null; created_at: string };

const day = (d: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium" }).format(new Date(`${d}T12:00:00Z`));

/** Tasks that workflow steps created for staff. Open ones first, soonest due first. */
export default async function TasksPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; show?: string }> }) {
  const sp = await searchParams;
  const all = sp.show === "all";
  const result = await load(async () => {
    let q = tenantClient(currentTenantId()).from("automation_tasks").select("id, title, due_on, done_at, contact_name, contact_email, lead_id, client_id, created_at");
    if (!all) q = q.is("done_at", null);
    const { data, error } = await q.order("due_on", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(300);
    if (error) throw new Error(error.message);
    return (data ?? []) as Task[];
  });
  return (
    <>
      <PageTitle title="Tasks">Follow-ups that your workflows created for you. Mark them done as you go.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Link className={all ? "monarch-secondary" : "monarch-primary"} href="/automation/tasks">Open</Link>
        <Link className={all ? "monarch-primary" : "monarch-secondary"} href="/automation/tasks?show=all">All</Link>
      </div>
      {!result.ok ? <SetupRequired message={result.message} /> : result.data.length === 0 ? <p className="monarch-muted">{all ? "No tasks yet." : "No open tasks. Add a Create a task step to a workflow to get follow-ups here."}</p> : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
          {result.data.map((t) => (
            <li key={t.id} className="monarch-panel" style={{ padding: 12, opacity: t.done_at ? 0.6 : 1 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                <strong style={{ textDecoration: t.done_at ? "line-through" : "none" }}>{t.title}</strong>
                {t.due_on && <span className="monarch-muted">due {day(t.due_on)}</span>}
                <span style={{ flex: 1 }} />
                <form action={t.done_at ? reopenTaskAction : completeTaskAction}><input type="hidden" name="id" value={t.id} /><button className="monarch-secondary">{t.done_at ? "Reopen" : "Mark done"}</button></form>
              </div>
              <div className="monarch-muted">
                {t.contact_name ?? t.contact_email ?? "No contact"}{t.contact_name && t.contact_email ? ` · ${t.contact_email}` : ""}
                {t.lead_id && <> · <Link href={`/leads/${t.lead_id}`}>lead</Link></>}
                {t.client_id && <> · <Link href={`/workspace/clients/${t.client_id}`}>client</Link></>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
