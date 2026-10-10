import { notFound } from "next/navigation";
import { Badge, Flash, PageTitle, when } from "@/components/admin/ui";
import { EVENTS } from "@/lib/automation/events.ts";
import { automationDeps } from "@/lib/automation/server";
import type { Action, Condition } from "@/lib/automation/types.ts";
import { removeWorkflowAction, saveWorkflowAction, testWorkflowAction, workflowStatusAction } from "../../actions";

const SLOTS = [0, 1, 2, 3, 4];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function WorkflowEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { id } = await params;
  const { notice, error } = await searchParams;
  const isNew = id === "new";
  if (!isNew && !UUID.test(id)) notFound();
  const deps = automationDeps();
  const [templates, wf] = await Promise.all([deps.repo.listTemplates(), isNew ? null : deps.repo.getWorkflow(id)]);
  if (!isNew && !wf) notFound();
  const conditions: Partial<Condition>[] = wf?.conditions ?? [];
  const actions: Partial<Action>[] = wf?.actions ?? [{ type: "send_email" }];
  const history = wf ? await deps.repo.listExecutions({ workflow_id: wf.id, limit: 10 }) : [];
  return (
    <>
      <PageTitle title={wf ? wf.name : "New workflow"} back={{ href: "/automation/workflows", label: "Workflows" }}>
        {wf ? <>Status: <Badge value={wf.status} /> · Last updated {when(wf.updated_at)}</> : "Choose what starts it, then add the steps. It is created paused."}
      </PageTitle>
      <Flash notice={notice} error={error} />
      <form action={saveWorkflowAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
        {wf && <input type="hidden" name="id" value={wf.id} />}
        <label>Name<input name="name" required maxLength={120} defaultValue={wf?.name} /></label>
        <label>Starts when
          <select name="trigger_event" defaultValue={wf?.trigger_event ?? ""} required>
            <option value="" disabled>Choose…</option>
            {Object.entries(EVENTS).map(([k, e]) => <option key={k} value={k}>{e.label}</option>)}
          </select>
        </label>
        <label className="is-wide">Description (optional)<input name="description" maxLength={1000} defaultValue={wf?.description ?? ""} /></label>
        <fieldset className="is-wide"><legend>Only when (optional)</legend>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ display: "flex", gap: 8 }}>
              <input name={`cond_field_${i}`} placeholder="field, e.g. origin" defaultValue={conditions[i]?.field} />
              <select name={`cond_op_${i}`} defaultValue={conditions[i]?.op ?? "eq"}><option value="eq">is</option><option value="neq">is not</option><option value="in">is one of</option></select>
              <input name={`cond_value_${i}`} placeholder="value" defaultValue={conditions[i]?.value} />
            </span>
          ))}
          <small className="monarch-muted">Fields depend on the trigger: origin, provider, error_kind. Leave blank to run every time.</small>
        </fieldset>
        <fieldset className="is-wide"><legend>Steps, in order</legend>
          {SLOTS.map((i) => {
            const a = actions[i] as (Partial<Action> & { template_id?: string; to?: string; include_setup_link?: boolean; note?: string }) | undefined;
            return (
              <span key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <b>{i + 1}.</b>
                <select name={`act_type_${i}`} defaultValue={a?.type ?? ""}><option value="">(none)</option><option value="send_email">Send email</option><option value="record_note">Record a note</option></select>
                <select name={`act_template_${i}`} defaultValue={a?.template_id ?? ""}><option value="">Template…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.active ? "" : " (off)"}</option>)}</select>
                <select name={`act_to_${i}`} defaultValue={a?.to ?? "customer"}><option value="customer">to the customer</option><option value="support">to Monarch support</option></select>
                <label className="monarch-check"><input type="checkbox" name={`act_setup_${i}`} defaultChecked={a?.include_setup_link} /> include setup link</label>
                <input name={`act_note_${i}`} placeholder="note (for Record a note)" defaultValue={a?.note} maxLength={300} />
              </span>
            );
          })}
        </fieldset>
        <label>Attempts before giving up (1–8)<input name="max_attempts" type="number" min={1} max={8} defaultValue={wf?.max_attempts ?? 4} /></label>
        <label>Don&apos;t repeat for the same license within (hours)<input name="cooldown_hours" type="number" min={0} max={720} defaultValue={wf?.cooldown_hours ?? 0} /></label>
        <div className="is-wide"><button className="monarch-primary">{wf ? "Save changes" : "Create workflow"}</button></div>
      </form>
      {wf && (
        <>
          <section className="monarch-panel" style={{ padding: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <form action={workflowStatusAction}><input type="hidden" name="id" value={wf.id} /><input type="hidden" name="status" value={wf.status === "active" ? "paused" : "active"} /><button className="monarch-primary">{wf.status === "active" ? "Pause" : "Turn on"}</button></form>
            <form action={testWorkflowAction}><input type="hidden" name="id" value={wf.id} /><button className="monarch-primary">Run a safe test</button></form>
            <p className="monarch-muted">A test uses sample data and emails only you. It never touches a customer, license or CRM.</p>
          </section>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Recent runs</h2></div></div>
            <div className="monarch-table-wrap"><table><thead><tr><th>WHEN</th><th>STATUS</th><th>TRIES</th><th>PROBLEM</th></tr></thead><tbody>
              {history.length === 0 ? <tr><td colSpan={4} className="monarch-empty">No runs yet.</td></tr> : history.map((e) => <tr key={e.id}><td>{when(e.created_at)}{e.is_test ? " (test)" : ""}</td><td><Badge value={e.status} /></td><td>{e.attempts}/{e.max_attempts}</td><td>{e.error ?? "—"}</td></tr>)}
            </tbody></table></div>
          </section>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2>Remove this workflow</h2>
            <p className="monarch-muted">A workflow that has never run is deleted. One with history is archived so its records stay. Type its exact name to confirm.</p>
            <form action={removeWorkflowAction} className="monarch-inline-form"><input type="hidden" name="id" value={wf.id} /><input name="confirm_name" placeholder={wf.name} required /><button className="monarch-secondary is-danger">Remove</button></form>
          </section>
        </>
      )}
    </>
  );
}
