import { notFound } from "next/navigation";
import { Badge, Flash, PageTitle } from "@/components/admin/ui";
import { workflowsUsing } from "@/lib/automation/admin.ts";
import { automationConfig, automationDeps } from "@/lib/automation/server";
import { renderTemplate, SAMPLE_VALUES, VARIABLES } from "@/lib/automation/template.ts";
import { saveTemplateAction, templateActiveAction, testTemplateAction } from "../../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TemplateEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { id } = await params;
  const { notice, error } = await searchParams;
  const isNew = id === "new";
  if (!isNew && !UUID.test(id)) notFound();
  const deps = automationDeps();
  const t = isNew ? null : await deps.repo.getTemplate(id);
  if (!isNew && !t) notFound();
  const used = t ? workflowsUsing(t.id, await deps.repo.listWorkflows()) : [];
  let preview: { subject: string; html: string } | null = null;
  if (t) {
    try { preview = renderTemplate(t.subject, t.body, SAMPLE_VALUES, { supportEmail: automationConfig().supportEmail }); } catch { preview = null; }
  }
  return (
    <>
      <PageTitle title={t ? t.name : "New template"} back={{ href: "/automation/templates", label: "Email templates" }}>{t ? <>Status: <Badge value={t.active ? "active" : "inactive"} /></> : "Write the subject and message. Unknown placeholders are rejected."}</PageTitle>
      <Flash notice={notice} error={error} />
      <form action={saveTemplateAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
        {t && <input type="hidden" name="id" value={t.id} />}
        <label>Name<input name="name" required maxLength={120} defaultValue={t?.name} /></label>
        <label>Subject<input name="subject" required maxLength={200} defaultValue={t?.subject} /></label>
        <label className="is-wide">Message<textarea name="body" required rows={14} maxLength={20000} defaultValue={t?.body} /></label>
        <div className="is-wide"><button className="monarch-primary">Save template</button></div>
      </form>
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2>Placeholders you can use</h2>
        <ul>{Object.entries(VARIABLES).map(([k, v]) => <li key={k}><code>{`{{${k}}}`}</code> {v}</li>)}</ul>
        <p className="monarch-muted">Values are escaped before sending, so a customer&apos;s name can never inject markup.</p>
      </section>
      {t && (
        <>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2>Preview (sample data)</h2>
            {preview ? <><p><b>Subject:</b> {preview.subject}</p><iframe title="Email preview" sandbox="" srcDoc={preview.html} style={{ width: "100%", height: 420, border: "1px solid #e7e5de" }} /></> : <p className="monarch-muted">This template cannot be previewed. Check the placeholders.</p>}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
              <form action={testTemplateAction}><input type="hidden" name="id" value={t.id} /><button className="monarch-primary">Send a test to me</button></form>
              <form action={templateActiveAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="active" value={t.active ? "no" : "yes"} /><button className="monarch-secondary">{t.active ? "Turn off" : "Turn on"}</button></form>
            </div>
            <p className="monarch-muted">Test emails go only to your own sign-in address and are labelled TEST.</p>
          </section>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2>Used by</h2>
            {used.length ? <ul>{used.map((w) => <li key={w.id}>{w.name} <Badge value={w.status} /></li>)}</ul> : <p className="monarch-muted">No workflow uses this template yet.</p>}
          </section>
        </>
      )}
    </>
  );
}
