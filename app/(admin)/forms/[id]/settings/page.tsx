import { notFound } from "next/navigation";
import { imageStore, requireAdmin, tenantDb } from "@/lib/admin";
import { SupabaseImagesRepo } from "@/lib/images/supabase-repo";
import { formLink } from "@/lib/forms/link";
import { workflowCatalog } from "@/lib/automation/server";
import { formDeps } from "@/lib/forms/server";
import { checkDefinition, inputFields, type Field, type FormDefinition } from "@/lib/forms/definition.ts";
import { FIRM_RELATIONSHIPS, FIRM_ROLE_LABELS, FIRM_ROLES, readSettings } from "@/lib/forms/settings.ts";
import { Flash, PageTitle, when } from "@/components/admin/ui";
import { FormTabs, formsLoad, FormsSetupRequired } from "@/components/forms/admin-bits";
import { deleteFormAction, duplicateFormAction, formStatusAction, saveFormDetailsAction, saveFormSettingsAction, saveFormThemeAction } from "../../actions";
import { ColorField } from "@/components/forms/color-field";
import { FORM_FONTS } from "@/lib/forms/theme.ts";
import { ArchivePanel } from "@/components/admin/archive";

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
    const [brands, link, images] = await Promise.all([
      deps.brandCatalog ? deps.brandCatalog().then((c) => c.brands).catch(() => []) : [],
      formLink(deps, form.public_id, settings),
      new SupabaseImagesRepo(tenantDb()).list(60).catch(() => []),
    ]);
    const store = imageStore();
    const library = images.map((i) => ({ id: i.id, url: store.publicUrl(i.storage_path), alt_text: i.alt_text, file_name: i.file_name }));
    return { form, version, def, senders: catalog.senders, versions, submitted, brands, link, library };
  });
  if (!result.ok) return <FormsSetupRequired message={result.message} />;
  if (!result.data) notFound();
  const { form, version, def, senders, versions, submitted, brands, link, library } = result.data;
  const s = readSettings(form.settings);
  const theme = s.theme;
  const fields = def ? inputFields(def) : [];
  const brandName = brands.find((b) => b.id === s.brand_domain_id)?.name ?? (brands.length === 1 ? brands[0].name : null);
  const closeLocal = s.close_at ? new Date(s.close_at).toISOString().slice(0, 16) : "";
  const people = [...s.firm.people, ...Array.from({ length: Math.max(0, 6 - s.firm.people.length) }, () => null)].slice(0, 6);
  return (
    <>
      <PageTitle title={form.name} back={{ href: "/forms", label: "Forms" }}>Settings: what the form is called, who it links to, who is told, and when it closes.</PageTitle>
      <Flash notice={notice} error={error} />
      <FormTabs form={form} active="settings" link={link} />

      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2>Public link</h2>
        {!link ? <p className="monarch-alert is-error">Your form links need your own web address. Add it under Settings → Email sending (the firm&apos;s &ldquo;web address&rdquo;), for example <code>forms.yourfirm.com</code>, and connect that domain to this app. Until then no public link is shown, because links never use a hosting address.</p> : version && form.status === "published" ? <p><code>{link}</code> · <a href={link} target="_blank" rel="noreferrer">Open</a></p> : <p className="monarch-muted">{version ? "The form is not taking submissions right now." : "Publish the form from the Build tab to make its link live."}</p>}
        <p className="monarch-muted">Form id for workflow conditions (<code>form_id</code>): <code>{form.id}</code> · Versions published: {versions.length}{version ? ` (current v${version.version}, ${when(version.published_at)})` : ""} · Real submissions: {submitted}</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {form.status === "published" && <form action={formStatusAction}><input type="hidden" name="id" value={form.id} /><input type="hidden" name="to" value="closed" /><button className="monarch-secondary">Close the form</button></form>}
          {form.status === "closed" && <form action={formStatusAction}><input type="hidden" name="id" value={form.id} /><input type="hidden" name="to" value="published" /><button className="monarch-primary">Reopen the form</button></form>}
          <form action={duplicateFormAction}><input type="hidden" name="id" value={form.id} /><button className="monarch-secondary">Duplicate</button></form>
        </div>
      </section>

      <form action={saveFormDetailsAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
        <input type="hidden" name="id" value={form.id} />
        <h2 className="is-wide">Form name and signing consent</h2>
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
        <h2 className="is-wide">Who filled out the form, and which customer is it?</h2>
        <p className="monarch-muted is-wide" style={{ margin: 0 }}>Every submission is saved on its own. These choices tell the system <b>who the person is</b> so their submission can be matched to a customer record and so we can email them a confirmation.</p>
        {!def && <p className="monarch-alert is-error is-wide">The draft has a problem (see the Build tab), so questions can&apos;t be listed here until it&apos;s fixed or published.</p>}
        <label>Which question is their email address?<QuestionSelect name="email_key" value={s.respondent.email_key} fields={fields} types={["email"]} none="Pick for me: the first email question" />
          <small className="monarch-muted">We use this to find their customer record, email their confirmation, and send a save-and-continue link.</small>
        </label>
        <label>Which question is their name?<QuestionSelect name="name_key" value={s.respondent.name_key} fields={fields} types={["short_text"]} none="Pick for me: the first question that asks for a name" />
          <small className="monarch-muted">Shown at the top of each submission and on the customer record.</small>
        </label>
        <label className="monarch-check is-wide"><input type="checkbox" name="create_customer" defaultChecked={s.create_customer} /> <span><b>Connect each submission to a customer record.</b> If a customer with that email already exists (for example from a package purchase), the submission is attached to them. If not, a new customer is created.</span></label>
        <label className="monarch-check is-wide"><input type="checkbox" name="add_to_leads" defaultChecked={s.add_to_leads} /> <span><b>Forms-to-Leads: add each respondent to Leads.</b> The form&apos;s name becomes their source. Someone who is already a lead keeps their current source and status.</span></label>

        <h2 className="is-wide">Set up a new tax office from this form (optional)</h2>
        <p className="monarch-muted is-wide" style={{ margin: 0 }}>Use this for onboarding forms, such as an ERO application. When someone submits, we can create their tax office in <b>My Service Bureau</b> automatically, with its EFIN and EIN, and up to <b>6 people</b> (owner, ERO, preparers) each with their own contact details and PTIN. Leave it off for ordinary forms.</p>
        <div className="is-wide mf-firm">
          <label className="monarch-check"><input type="checkbox" name="firm_enabled" defaultChecked={s.firm.enabled} /> <span><b>Create or link a tax office from each submission.</b> If the customer already has an office, or an office with the same EFIN exists, we link to it. Otherwise a new office is created, marked &ldquo;onboarding in progress&rdquo; for you to review.</span></label>
          {/* Shown only while the box above is ticked (CSS :has), so ordinary forms don't see office settings. */}
          <div className="mf-firm-body monarch-form">
            <label className="is-wide">How are they related to you? *<select name="firm_relationship" defaultValue={s.firm.relationship ?? ""}><option value="">Choose…</option>{FIRM_RELATIONSHIPS.map((r) => <option key={r} value={r}>{RELATIONSHIP_LABELS[r]}</option>)}</select></label>
            <details className="is-wide mf-collapse" open={!s.firm.legal_name_key}>
              <summary>Which questions hold the office&apos;s details</summary>
              <div className="monarch-form">
                <label>Which question is the legal business name?<QuestionSelect name="firm_legal_name" value={s.firm.legal_name_key} fields={fields} types={["short_text"]} /></label>
                <label>Which question is the &ldquo;doing business as&rdquo; name?<QuestionSelect name="firm_dba" value={s.firm.dba_name_key} fields={fields} types={["short_text"]} /></label>
                <label>Which question is the office address?<QuestionSelect name="firm_address" value={s.firm.address_key} fields={fields} types={["address"]} /></label>
                <label>Which question is the EFIN?<QuestionSelect name="firm_efin" value={s.firm.efin_key} fields={fields} types={["short_text"]} format="efin" />
                  <small className="monarch-muted">The IRS e-file number. Only short answers set to &ldquo;Check as EFIN&rdquo; in the builder are listed.</small>
                </label>
                <label>Which question is the EIN?<QuestionSelect name="firm_ein" value={s.firm.ein_key} fields={fields} types={["short_text"]} format="ein" />
                  <small className="monarch-muted">The business&apos;s federal tax ID. Only short answers set to &ldquo;Check as EIN&rdquo; are listed.</small>
                </label>
              </div>
            </details>
            <details className="is-wide mf-collapse" open={!s.firm.people.length}>
              <summary>People at the office ({s.firm.people.length ? `${s.firm.people.length} mapped` : "up to 6; put the ERO first"})</summary>
              <div style={{ display: "grid", gap: 8, paddingTop: 8 }}>
                <small className="monarch-muted">For each person, choose their role and which question holds their name, email, phone and PTIN. Leave a row on &ldquo;Name: (none)&rdquo; to skip it.</small>
                {people.map((p, i) => (
                  <span key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <select name={`p_role_${i}`} defaultValue={p?.role ?? (i === 0 ? "ero" : "tax_preparer")} aria-label={`Person ${i + 1} role`}>{FIRM_ROLES.map((r) => <option key={r} value={r}>{FIRM_ROLE_LABELS[r]}</option>)}</select>
                    <QuestionSelect name={`p_name_${i}`} value={p?.name_key ?? null} fields={fields} types={["short_text"]} none="Name: (none)" />
                    <QuestionSelect name={`p_email_${i}`} value={p?.email_key ?? null} fields={fields} types={["email"]} none="Email: (none)" />
                    <QuestionSelect name={`p_phone_${i}`} value={p?.phone_key ?? null} fields={fields} types={["phone"]} none="Phone: (none)" />
                    <QuestionSelect name={`p_ptin_${i}`} value={p?.ptin_key ?? null} fields={fields} types={["short_text"]} format="ptin" none="PTIN: (none)" />
                  </span>
                ))}
                <small className="monarch-muted">EFINs, EINs and PTINs are encrypted the same way My Service Bureau stores them. New offices start with the EFIN unconfirmed and a draft ERO assignment.</small>
              </div>
            </details>
          </div>
        </div>

        <h2 className="is-wide">Notifications</h2>
        <label>Tell these addresses about each submission (up to 5)<input name="recipients" defaultValue={s.notify.recipients.join(", ")} placeholder="Blank: your firm profile's email" /></label>
        <label>Send from<select name="sender_id" defaultValue={s.notify.sender_id ?? ""}><option value="">{brandName ? `${brandName}'s default sending address` : "Your default sending address"}</option>{senders.filter((x) => brands.length < 2 || !s.brand_domain_id || x.domain_id === s.brand_domain_id).map((x) => <option key={x.id} value={x.id}>{x.from_name} &lt;{x.address}&gt;</option>)}</select></label>
        <label className="monarch-check is-wide"><input type="checkbox" name="confirmation_email" defaultChecked={s.confirmation_email} /> Email the respondent a confirmation (&ldquo;we received your submission&rdquo;; no answers or files)</label>
        <label className="is-wide">Extra text for the confirmation email (optional)<textarea name="confirmation_email_text" rows={2} maxLength={2000} defaultValue={s.confirmation_email_text} /></label>
        <small className="monarch-muted is-wide">The notice to you has the form, number, time and respondent, with a link to the submission. Answers and files stay in the admin.</small>

        <h2 className="is-wide">What happens when they click Submit?</h2>
        <p className="monarch-muted is-wide" style={{ margin: 0 }}>Choose <b>one</b>. Either way the submission is saved, the PDF is made, and your emails and workflows run.</p>
        <div className="is-wide mf-after">
          <div className="mf-choice">
            <label className="monarch-check"><input type="radio" name="after_submit" value="message" defaultChecked={s.after_submit !== "redirect"} /> <b>Show a thank-you message</b></label>
            <small className="monarch-muted">The respondent stays on your form page and sees the message below, with a button to download their PDF copy.</small>
            <label>Message they will see<textarea name="confirmation_message" rows={4} maxLength={2000} defaultValue={s.confirmation_message} />
              <small className="monarch-muted">Put <b>**two asterisks**</b> around words to make them bold. Press Enter for a new line; leave a blank line for a new paragraph.</small>
            </label>
          </div>
          <div className="mf-choice">
            <label className="monarch-check"><input type="radio" name="after_submit" value="redirect" defaultChecked={s.after_submit === "redirect"} /> <b>Send them to another web page</b></label>
            <small className="monarch-muted">The respondent is taken straight to the address below, for example a thank-you page on your own website. They won&apos;t see the message or the PDF button.</small>
            <label>Web address to send them to<input name="redirect_url" type="url" inputMode="url" maxLength={2000} defaultValue={s.redirect_url ?? ""} placeholder="https://www.yourfirm.com/thank-you" />
              <small className="monarch-muted">A full address starting with https://</small>
            </label>
          </div>
        </div>
        <h2 className="is-wide">Closing and limits</h2>
        <label className="is-wide">Message when the form is closed<textarea name="closed_message" rows={2} maxLength={1000} defaultValue={s.closed_message} /></label>
        <label>Close automatically at (UTC, optional)<input type="datetime-local" name="close_at" defaultValue={closeLocal} /></label>
        <label>Stop after this many submissions (optional)<input type="number" name="max_submissions" min={1} defaultValue={s.max_submissions ?? ""} /></label>
        <label className="monarch-check is-wide"><input type="checkbox" name="allow_save_later" defaultChecked={s.allow_save_later} /> Let respondents save and continue later (we email them a link that works for 30 days)</label>
        <div className="is-wide"><button className="monarch-primary">Save settings</button></div>
      </form>

      <form action={saveFormThemeAction} className="monarch-panel monarch-form" style={{ padding: 20 }} encType="multipart/form-data" id="look">
        <input type="hidden" name="id" value={form.id} />
        <h2 className="is-wide">Look of the form</h2>
        <p className="monarch-muted is-wide" style={{ margin: 0 }}>Make the public form match your office. Anything you leave on &ldquo;Standard&rdquo; keeps the default look. <a href={`/forms/${form.id}/preview`} target="_blank" rel="noreferrer">Preview the draft</a>{link && version && form.status === "published" ? <> · <a href={link} target="_blank" rel="noreferrer">Open the live form</a></> : null}</p>
        <ColorField name="background" label="Page background" value={theme.background} />
        <ColorField name="card" label="Form background" value={theme.card} />
        <ColorField name="header" label="Header colour" value={theme.header} />
        <ColorField name="text" label="Text colour" value={theme.text} />
        <ColorField name="button" label="Button colour" value={theme.button} />
        <label>Font<select name="font" defaultValue={theme.font}>{Object.entries(FORM_FONTS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}</select></label>
        {(["logo", "header"] as const).map((field) => {
          const current = field === "logo" ? theme.logo_url : theme.header_image_url;
          return (
            <div key={field} className="is-wide" style={{ display: "grid", gap: 6 }}>
              <span className="field-label">{field === "logo" ? "Logo" : "Header image (shown behind the logo across the top)"}</span>
              {current && <span className="monarch-muted">Current: <a href={current} target="_blank" rel="noreferrer">view</a> <label className="monarch-check" style={{ display: "inline-flex" }}><input type="checkbox" name={`${field}_remove`} /> Remove it</label></span>}
              <label>Upload a new one (PNG, JPG or WebP, up to 4 MB)<input type="file" name={`${field}_file`} accept="image/png,image/jpeg,image/webp" /></label>
              {library.length > 0 && (
                <details className="mf-collapse">
                  <summary>Or choose from your Images ({library.length})</summary>
                  <div className="img-pick" role="radiogroup" aria-label={`Choose a ${field} from your Images`}>
                    <label><input type="radio" name={`${field}_pick`} value="" defaultChecked /> No change</label>
                    {library.map((img) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <label key={img.id} title={img.file_name}><img src={img.url} alt={img.alt_text ?? ""} /><span><input type="radio" name={`${field}_pick`} value={img.id} defaultChecked={false} /> {img.file_name.slice(0, 18)}</span></label>
                    ))}
                  </div>
                </details>
              )}
            </div>
          );
        })}
        <label className="is-wide">Custom CSS (optional, for designers)
          <textarea name="custom_css" rows={8} maxLength={10000} spellCheck={false} defaultValue={theme.custom_css} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} placeholder={"body { background: #faf7f0; }\nh1 { font-family: Georgia, serif; color: #12324f; }\n.monarch-primary { border-radius: 999px; }"} />
          <small className="monarch-muted">Change the page background, text colours, fonts and overall look. Your CSS only affects this form: <code>body</code> means the form&apos;s page. Imports, scripts, fixed-position overlays and unsafe values are removed automatically. Images must be https:// addresses.</small>
        </label>
        <div className="is-wide"><button className="monarch-primary">Save the look</button></div>
      </form>

      {/* Archive hides the form and keeps everything; Delete (below) removes it for good. */}
      <ArchivePanel entity="form" id={form.id} askReason={false} permanentDelete={false} />

      <form action={deleteFormAction} className="monarch-panel" style={{ padding: 20, display: "grid", gap: 10 }}>
        <input type="hidden" name="id" value={form.id} />
        <h2>Delete this form</h2>
        <p className="monarch-muted" style={{ margin: 0 }}>Deleting removes the form for good: it leaves the app now, and its stored files (uploads and PDFs) are permanently deleted after 24 hours. They can&apos;t be recovered after that. To keep everything, archive it instead.</p>
        {submitted > 0 && (
          <label className="monarch-check"><input type="checkbox" name="with_submissions" required /> <span><b>Delete with submissions</b>: also delete its {submitted} submission{submitted === 1 ? "" : "s"} (answers, uploads and PDFs). Leads, contacts, customers and tax offices made from them are separate records and are kept.</span></label>
        )}
        <label style={{ display: "grid", gap: 4, maxWidth: 420 }} className="monarch-muted">To confirm, type the form&apos;s name: <b style={{ color: "inherit" }}>{form.name}</b>
          <input name="confirm" required autoComplete="off" placeholder={form.name} style={{ padding: "10px 12px", border: "1px solid #d4d4d4", borderRadius: 8 }} />
        </label>
        <div><button className="monarch-secondary is-danger">{submitted > 0 ? "Delete form and submissions" : "Delete form"}</button></div>
      </form>
    </>
  );
}
