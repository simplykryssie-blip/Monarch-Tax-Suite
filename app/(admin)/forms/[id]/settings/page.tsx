import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { formLink } from "@/lib/forms/link";
import { workflowCatalog } from "@/lib/automation/server";
import { formDeps } from "@/lib/forms/server";
import { checkDefinition, inputFields, type Field, type FormDefinition } from "@/lib/forms/definition.ts";
import { FIRM_RELATIONSHIPS, FIRM_ROLE_LABELS, FIRM_ROLES, readSettings } from "@/lib/forms/settings.ts";
import { Flash, PageTitle, when } from "@/components/admin/ui";
import { FormTabs, formsLoad, FormsSetupRequired } from "@/components/forms/admin-bits";
import { duplicateFormAction, formStatusAction, removeFormAction, saveFormDetailsAction, saveFormSettingsAction } from "../../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RELATIONSHIP_LABELS: Record<string, string> = { partner: "Partner ERO (you manage their preparers)", client: "Software or service client (no team or PTINs)", internal: "My own tax office" };

function QuestionSelect({ name, value, fields, types, format, none = "(none)" }: { name: string; value: string | null; fields: Field[]; types: string[]; format?: string; none?: string }) {
  const options = fields.filter((f) => types.includes(f.type) && (format === undefined || f.format === format));
  return (
    <select name={name} defaultValue={value ?? ""}>
      <option value="">{none}</option>
      {options.map((f) => <option key={f.key} value={f.key}>{f.label || f.key} ({f.key})</option>)}
    </select>
  );
}

export default async function FormSettingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { notice, error } = await searchParams;
  if (!UUID.test(id)) notFound();
  const result = await formsLoad(async () => {
    const deps = formDeps();
    const form = await deps.repo.getForm(id);
    if (!form) return null;
    const version = form.current_version_id ? await deps.repo.getVersion(form.current_version_id) : null;
    let def: FormDefinition | null = null;
    try { def = checkDefinition(form.draft_definition); } catch { def = version?.definition ?? null; }
    const [catalog, versions, submitted] = await Promise.all([workflowCatalog(), deps.repo.listVersions(form.id), deps.repo.countSubmitted(form.id)]);
    const settings = readSettings(form.settings);
    const [brands, link] = await Promise.all([deps.brandCatalog ? deps.brandCatalog().then((c) => c.brands).catch(() => []) : [], formLink(deps, form.public_id, settings)]);
    return { form, version, def, senders: catalog.senders, versions, submitted, brands, link };
  });
  if (!result.ok) return <FormsSetupRequired message={result.message} />;
  if (!result.data) notFound();
  const { form, version, def, senders, versions, submitted, brands, link } = result.data;
  const s = readSettings(form.settings);
  const fields = def ? inputFields(def) : [];
  const brandName = brands.find((b) => b.id === s.brand_domain_id)?.name ?? (brands.length === 1 ? brands[0].name : null);
  const closeLocal = s.close_at ? new Date(s.close_at).toISOString().slice(0, 16) : "";
  const people = [...s.firm.people, ...Array.from({ length: Math.max(0, 6 - s.firm.people.length) }, () => null)].slice(0, 6);
  return (
    <>
      <PageTitle title={form.name} back={{ href: "/forms", label: "Forms" }}>Settings: what the form is called, who it links to, who is told, and when it closes.</PageTitle>
      <Flash notice={notice} error={error} />
      <FormTabs form={form} active="settings" />

      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2>Public link</h2>
        {version && form.status === "published" ? <p><code>{link}</code> · <a href={link} target="_blank" rel="noreferrer">Open</a></p> : <p className="monarch-muted">{version ? "The form is not taking submissions right now." : "Publish the form from the Build tab to make its link live."}</p>}
        <p className="monarch-muted">Form id for workflow conditions (<code>form_id</code>): <code>{form.id}</code> · Versions published: {versions.length}{version ? ` (current v${version.version}, ${when(version.published_at)})` : ""} · Real submissions: {submitted}</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {form.status === "published" && <form action={formStatusAction}><input type="hidden" name="id" value={form.id} /><input type="hidden" name="to" value="closed" /><button className="monarch-secondary">Close the form</button></form>}
          {form.status === "closed" && <form action={formStatusAction}><input type="hidden" name="id" value={form.id} /><input type="hidden" name="to" value="published" /><button className="monarch-primary">Reopen the form</button></form>}
          {form.status !== "archived" ? <form action={formStatusAction}><input type="hidden" name="id" value={form.id} /><input type="hidden" name="to" value="archived" /><button className="monarch-secondary">Archive</button></form>
            : <form action={formStatusAction}><input type="hidden" name="id" value={form.id} /><input type="hidden" name="to" value="restore" /><button className="monarch-primary">Restore</button></form>}
          <form action={duplicateFormAction}><input type="hidden" name="id" value={form.id} /><button className="monarch-secondary">Duplicate</button></form>
        </div>
      </section>

      <form action={saveFormDetailsAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
        <input type="hidden" name="id" value={form.id} />
        <h2 className="is-wide">Details and signing consent</h2>
        <label>Name<input name="name" required minLength={2} maxLength={120} defaultValue={form.name} /></label>
        <label>Description shown under the title (optional)<input name="description" maxLength={1000} defaultValue={form.description ?? ""} /></label>
        <label className="is-wide">Signing consent statement (needed when the form has a signature question)
          <textarea name="consent" rows={5} maxLength={5000} defaultValue={form.signature_consent ?? ""} placeholder="Write, in your own words, what the signer agrees to: signing electronically, that the signature is binding, how to get a paper copy, and so on." />
          <small className="monarch-muted">Respondents must tick that they agree before signing. Each submission keeps the exact text they saw, and the PDF prints it. Have counsel review it before real clients sign.</small>
        </label>
        <div className="is-wide"><button className="monarch-primary">Save details</button></div>
      </form>

      <form action={saveFormSettingsAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
        <input type="hidden" name="id" value={form.id} />
        {brands.length > 1 ? (
          <>
            <h2 className="is-wide">Firm</h2>
            <label>Which firm does this form belong to?
              <select name="brand_domain_id" required defaultValue={s.brand_domain_id ?? ""}>
                <option value="" disabled>Choose a firm</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.linkHost ? ` (${b.linkHost})` : ` (${b.domain})`}</option>)}
              </select>
            </label>
            <small className="monarch-muted is-wide">The public link uses this firm&apos;s web address, and the form&apos;s emails come from this firm&apos;s sending addresses. Set each firm&apos;s name and web address in Settings → Email sending.</small>
          </>
        ) : brands.length === 1 ? <input type="hidden" name="brand_domain_id" value={brands[0].id} /> : null}
        <h2 className="is-wide">Respondent and customer</h2>
        {!def && <p className="monarch-alert is-error is-wide">The draft has a problem (see the Build tab), so questions can&apos;t be listed here until it&apos;s fixed or published.</p>}
        <label>Respondent&apos;s email question<QuestionSelect name="email_key" value={s.respondent.email_key} fields={fields} types={["email"]} none="Automatic: the form's first email question" /></label>
        <label>Respondent&apos;s name question<QuestionSelect name="name_key" value={s.respondent.name_key} fields={fields} types={["short_text"]} none="Automatic: the first name question" /></label>
        <label className="monarch-check is-wide"><input type="checkbox" name="create_customer" defaultChecked={s.create_customer} /> Link each submission to the customer with that email (for example, from their package purchase), and create the customer when there isn&apos;t one.</label>

        <h2 className="is-wide">Firm record (My Service Bureau)</h2>
        <label className="monarch-check is-wide"><input type="checkbox" name="firm_enabled" defaultChecked={s.firm.enabled} /> Create or link the respondent&apos;s tax office as a firm. A firm already linked to the customer, or with the same EFIN, is linked; otherwise a new one is created.</label>
        <label>Relationship<select name="firm_relationship" defaultValue={s.firm.relationship}>{FIRM_RELATIONSHIPS.map((r) => <option key={r} value={r}>{RELATIONSHIP_LABELS[r]}</option>)}</select></label>
        <label>Legal business name<QuestionSelect name="firm_legal_name" value={s.firm.legal_name_key} fields={fields} types={["short_text"]} /></label>
        <label>DBA name<QuestionSelect name="firm_dba" value={s.firm.dba_name_key} fields={fields} types={["short_text"]} /></label>
        <label>Office address<QuestionSelect name="firm_address" value={s.firm.address_key} fields={fields} types={["address"]} /></label>
        <label>EFIN (a short answer checked as EFIN)<QuestionSelect name="firm_efin" value={s.firm.efin_key} fields={fields} types={["short_text"]} format="efin" /></label>
        <label>EIN (a short answer checked as EIN)<QuestionSelect name="firm_ein" value={s.firm.ein_key} fields={fields} types={["short_text"]} format="ein" /></label>
        <fieldset className="is-wide" style={{ display: "grid", gap: 8 }}><legend>People (the ERO first; up to 6 here)</legend>
          {people.map((p, i) => (
            <span key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select name={`p_role_${i}`} defaultValue={p?.role ?? (i === 0 ? "ero" : "tax_preparer")} aria-label={`Person ${i + 1} role`}>{FIRM_ROLES.map((r) => <option key={r} value={r}>{FIRM_ROLE_LABELS[r]}</option>)}</select>
              <QuestionSelect name={`p_name_${i}`} value={p?.name_key ?? null} fields={fields} types={["short_text"]} none="Name: (none)" />
              <QuestionSelect name={`p_email_${i}`} value={p?.email_key ?? null} fields={fields} types={["email"]} none="Email: (none)" />
              <QuestionSelect name={`p_phone_${i}`} value={p?.phone_key ?? null} fields={fields} types={["phone"]} none="Phone: (none)" />
              <QuestionSelect name={`p_ptin_${i}`} value={p?.ptin_key ?? null} fields={fields} types={["short_text"]} format="ptin" none="PTIN: (none)" />
            </span>
          ))}
          <small className="monarch-muted">EFINs, EINs and PTINs are encrypted the same way My Service Bureau stores them. New firms start as onboarding in progress, with the EFIN unconfirmed and a draft ERO assignment, for you to review.</small>
        </fieldset>

        <h2 className="is-wide">Notifications</h2>
        <label>Tell these addresses about each submission (up to 5)<input name="recipients" defaultValue={s.notify.recipients.join(", ")} placeholder="Blank: your firm profile's email" /></label>
        <label>Send from<select name="sender_id" defaultValue={s.notify.sender_id ?? ""}><option value="">{brandName ? `${brandName}'s default sending address` : "Your default sending address"}</option>{senders.filter((x) => brands.length < 2 || !s.brand_domain_id || x.domain_id === s.brand_domain_id).map((x) => <option key={x.id} value={x.id}>{x.from_name} &lt;{x.address}&gt;</option>)}</select></label>
        <label className="monarch-check is-wide"><input type="checkbox" name="confirmation_email" defaultChecked={s.confirmation_email} /> Email the respondent a confirmation (&ldquo;we received your submission&rdquo;; no answers or files)</label>
        <label className="is-wide">Extra text for the confirmation email (optional)<textarea name="confirmation_email_text" rows={2} maxLength={2000} defaultValue={s.confirmation_email_text} /></label>
        <small className="monarch-muted is-wide">The notice to you has the form, number, time and respondent, with a link to the submission. Answers and files stay in the admin.</small>

        <h2 className="is-wide">Messages and limits</h2>
        <label className="is-wide">Confirmation screen message<textarea name="confirmation_message" rows={2} maxLength={2000} defaultValue={s.confirmation_message} /></label>
        <label className="is-wide">Message when the form is closed<textarea name="closed_message" rows={2} maxLength={1000} defaultValue={s.closed_message} /></label>
        <label>Close automatically at (UTC, optional)<input type="datetime-local" name="close_at" defaultValue={closeLocal} /></label>
        <label>Stop after this many submissions (optional)<input type="number" name="max_submissions" min={1} defaultValue={s.max_submissions ?? ""} /></label>
        <label className="monarch-check is-wide"><input type="checkbox" name="allow_save_later" defaultChecked={s.allow_save_later} /> Let respondents save and continue later (we email them a link that works for 30 days)</label>
        <div className="is-wide"><button className="monarch-primary">Save settings</button></div>
      </form>

      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2>Delete this form</h2>
        <p className="monarch-muted">A form that was never submitted is deleted. One with submissions is archived instead, and its submissions are kept. Type its exact name to confirm.</p>
        <form action={removeFormAction} className="monarch-inline-form"><input type="hidden" name="id" value={form.id} /><input name="confirm_name" placeholder={form.name} required /><button className="monarch-secondary is-danger">Delete</button></form>
      </section>
    </>
  );
}
