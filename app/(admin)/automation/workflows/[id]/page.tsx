import { notFound } from "next/navigation";
import { Badge, Flash, PageTitle, when } from "@/components/admin/ui";
import { ArchivePanel } from "@/components/admin/archive";
import { EVENTS } from "@/lib/automation/events.ts";
import { automationDeps, workflowCatalog } from "@/lib/automation/server";
import { stepsOf } from "@/lib/automation/steps.ts";
import type { Condition, Step } from "@/lib/automation/types.ts";
import { OffsetField, StepBuilder } from "@/components/automation/step-builder";
import { commerceRepo } from "@/lib/admin";
import { pipelinesRepo } from "@/lib/pipelines/server";
import { isLive } from "@/lib/pipelines/service.ts";
import { saveWorkflowAction, testWorkflowAction, testWorkflowWithClientAction, workflowStatusAction } from "../../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function WorkflowEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { id } = await params;
  const { notice, error } = await searchParams;
  const isNew = id === "new";
  if (!isNew && !UUID.test(id)) notFound();
  const deps = automationDeps();
  const [templates, wf, catalog] = await Promise.all([deps.repo.listTemplates(), isNew ? null : deps.repo.getWorkflow(id), workflowCatalog(deps)]);
  const pipelines = await pipelinesRepo().list().catch(() => []);
  const activeDocs = catalog.documents.filter((d) => d.status === "active");
  if (!isNew && !wf) notFound();
  const conditions: Partial<Condition>[] = wf?.conditions ?? [];
  const initialSteps: Step[] = wf ? stepsOf(wf) : [{ type: "send_email", template_id: "", to: "customer", include_setup_link: false }];
  const history = wf ? await deps.repo.listExecutions({ workflow_id: wf.id, limit: 10 }) : [];
  const clients = wf ? (await commerceRepo().listCustomers().catch(() => [])).slice().sort((a, b) => (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email)).slice(0, 500) : [];
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
              <input name={`cond_field_${i}`} placeholder="field, e.g. origin" defaultValue={conditions[i]?.field} list="condition-fields" />
              <select name={`cond_op_${i}`} defaultValue={conditions[i]?.op ?? "eq"}><option value="eq">is</option><option value="neq">is not</option><option value="in">is one of</option></select>
              <input name={`cond_value_${i}`} placeholder="value" defaultValue={conditions[i]?.value} />
            </span>
          ))}
          <datalist id="condition-fields">
            {["origin", "provider", "error_kind", "document_id", "form_id", ...catalog.attributes.map((a) => `product.${a.key}`), ...[...new Set((catalog.forms ?? []).flatMap((f) => f.questions.filter((q) => q.type === "dropdown" || q.type === "radio").map((q) => `answer.${q.key}`)))]].map((f) => <option key={f} value={f} />)}
          </datalist>
          <small className="monarch-muted">Fields depend on the trigger: origin, provider, error_kind, or document_id for document events (a document&apos;s id from its page). Leave blank to run every time.</small>
          {(catalog.forms ?? []).length > 0 && (
            <small className="monarch-muted">
              Form submitted: limit it to one form with <code>form_id</code> is the form&apos;s id, then test dropdown or radio answers with <code>answer.&lt;key&gt;</code>.{" "}
              {(catalog.forms ?? []).map((f) => <span key={f.id}>&ldquo;{f.name}&rdquo; <code>{f.id}</code>{f.questions.some((q) => q.type === "dropdown" || q.type === "radio") ? `: ${f.questions.filter((q) => q.type === "dropdown" || q.type === "radio").map((q) => `answer.${q.key} (${q.options.join(", ")})`).join("; ")}` : ""}. </span>)}
            </small>
          )}
          {catalog.attributes.length > 0 && <small className="monarch-muted">Package attributes, for any trigger with an order: {catalog.attributes.map((a) => <span key={a.key}><code>product.{a.key}</code>{a.kind === "choice" ? ` (${a.options.join(", ")})` : ""} </span>)}</small>}
        </fieldset>
        <OffsetField initialTrigger={wf?.trigger_event ?? ""} initial={typeof wf?.trigger_config?.offset_days === "number" ? wf.trigger_config.offset_days : null} />
        <StepBuilder
          initial={initialSteps}
          initialTrigger={wf?.trigger_event ?? ""}
          catalog={{
            templates: templates.map((t) => ({ id: t.id, name: t.name, active: t.active })),
            documents: activeDocs.map((d) => ({ id: d.id, name: d.name, file_type: d.file_type })),
            senders: catalog.senders.map((x) => ({ id: x.id, label: `${x.from_name} <${x.address}>` })),
            pipelines: pipelines.filter(isLive).map((x) => ({ id: x.id, name: x.name, stages: x.stages.map((st) => ({ id: st.id, name: st.name })) })),
          }}
        />
        <label>Attempts before giving up (1–8)<input name="max_attempts" type="number" min={1} max={8} defaultValue={wf?.max_attempts ?? 4} /></label>
        <label>Don&apos;t repeat for the same license within (hours)<input name="cooldown_hours" type="number" min={0} max={720} defaultValue={wf?.cooldown_hours ?? 0} /></label>
        <div className="is-wide"><button className="monarch-primary">{wf ? "Save changes" : "Create workflow"}</button></div>
      </form>
      {wf && (
        <>
          <section className="monarch-panel" style={{ padding: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
            {wf.status !== "archived" && <form action={workflowStatusAction}><input type="hidden" name="id" value={wf.id} /><input type="hidden" name="status" value={wf.status === "active" ? "paused" : "active"} /><button className="monarch-primary">{wf.status === "active" ? "Pause" : "Turn on"}</button></form>}
            <form action={testWorkflowAction}><input type="hidden" name="id" value={wf.id} /><button className="monarch-primary">Run a safe test</button></form>
            <p className="monarch-muted">A safe test uses sample data and emails only you. It never touches a customer, license or CRM.</p>
          </section>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2>Test with a client</h2>
            <p className="monarch-muted">Runs every step end to end for the client you choose. Steps that would send an email, text or document are checked (the message is filled in and the recipient found) but <b>never sent</b>, and the test carries on to the next step. Each step&apos;s result is in Run history.</p>
            <form action={testWorkflowWithClientAction} className="monarch-inline-form" style={{ flexWrap: "wrap" }}>
              <input type="hidden" name="id" value={wf.id} />
              <select name="customer_id" required defaultValue="" aria-label="Test client">
                <option value="" disabled>{clients.length ? "Choose a client…" : "No clients yet"}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.full_name ?? c.email}{c.full_name ? ` (${c.email})` : ""}</option>)}
              </select>
              <button className="monarch-primary" disabled={clients.length === 0}>Run test</button>
            </form>
          </section>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Recent runs</h2><p>Every step of every run is in Run history (top right).</p></div></div>
            <div className="monarch-table-wrap"><table><thead><tr><th>WHEN</th><th>STATUS</th><th>TRIES</th><th>PROBLEM</th></tr></thead><tbody>
              {history.length === 0 ? <tr><td colSpan={4} className="monarch-empty">No runs yet.</td></tr> : history.map((e) => <tr key={e.id}><td>{when(e.created_at)}{e.is_test ? " (test)" : ""}</td><td><Badge value={e.status} /></td><td>{e.attempts}/{e.max_attempts}</td><td>{e.error ?? "—"}</td></tr>)}
            </tbody></table></div>
          </section>
          <ArchivePanel entity="workflow" id={wf.id} />
        </>
      )}
    </>
  );
}
