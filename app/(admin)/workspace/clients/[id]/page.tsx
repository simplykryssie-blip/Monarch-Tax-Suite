import { FormattedInput } from "@/components/forms/formatted-input";
import { StateSelect } from "@/components/forms/state-select";
import { PortalPanel } from "@/components/portal/panel";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, EmptyRow, Flash, PageTitle, when } from "@/components/admin/ui";
import { DetailsCard, type Details } from "@/components/contacts/details-card";
import { MergeChoice } from "@/components/contacts/merge-choice";
import { MessageComposer } from "@/components/contacts/message-composer";
import { NewInvoice } from "@/components/contacts/new-invoice";
import { Modal } from "@/components/ui/modal";
import { duplicatesOfClient } from "@/lib/contacts/duplicates.ts";
import { loadContacts } from "@/lib/contacts/server";
import { documentDeps } from "@/lib/documents/server";
import { portalMemberRepo } from "@/lib/portal/server";
import { describeEvent } from "@/lib/workspace/activity.ts";
import { balance, dollars, invoiceView, splitName } from "@/lib/workspace/rules.ts";
import { ENTITY_TYPES, PAYERS, RELATIONSHIPS, RETURN_KINDS } from "@/lib/workspace/types.ts";
import { InvoiceActions } from "@/components/contacts/invoice-actions";
import { paymentsFor } from "@/lib/workspace/receipts";
import { InvoiceLink, loadSheetContext } from "@/components/contacts/invoice-sheet";
import { hasStoredSsn } from "@/lib/ssn/service.ts";
import { ssnDeps } from "@/lib/ssn/server";
import type { ClientTask } from "@/lib/workspace/types";
import { workflowTasksFor } from "@/lib/workspace/workflow-tasks";
import { pipelinesRepo } from "@/lib/pipelines/server";
import { boardStages, todayIso, workspaceLoad, workspaceRepo } from "@/lib/workspace/load";
import { TagInput } from "@/app/(admin)/leads/tag-input";
import { cancelFormInviteAction, invitePortalAction } from "@/app/portal-staff-actions";
import { formDeps } from "@/lib/forms/server";
import { inviteStatus } from "@/lib/forms/invites.ts";
import { ClientDrive } from "../../../documents/client-drive";
import { addBusinessAction, addDependentAction, addNoteAction, addReturnAction, addTaskAction, archiveClientAction, linkSpouseAction, logMessageAction, mergeClientsAction, mergeLeadIntoClientAction, removeBusinessAction, removeDependentAction, removeSpouseAction, saveClientTagsAction, saveSpouseAction, toggleTaskAction, unlinkSpouseAction } from "../../actions";
import { toE164 } from "@/lib/automation/twilio.ts";
import { tenantSms } from "@/lib/sms/server";
import { emailConfig, emailKeyProblems } from "@/lib/automation/email.ts";
import { WorkspaceSetup } from "../../setup";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Returns, Tasks, Notes and Activity open from the Overview (See all), so they are not in the tab bar. The portal lives in Documents.
const TABS = [["overview", "Overview"], ["documents", "Documents"], ["messages", "Messages"], ["billing", "Billing"]] as const;
const HIDDEN = ["returns", "tasks", "notes", "activity"] as const;
const CHANNELS = { email: "Email", sms: "Text", call: "Call", other: "Other", portal: "Portal" } as const;
const FIVE = 5;

/** One client: the Overview with everything about them at a glance, their documents, messages and billing. */
export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; sign?: string; folder?: string; notice?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  // The old Portal tab now lives inside Documents, so an old link to it lands there.
  const asked = sp.tab === "portal" ? "documents" : sp.tab;
  const tab = TABS.some(([k]) => k === asked) || (HIDDEN as readonly string[]).includes(asked ?? "") ? asked! : "overview";
  const today = todayIso();
  const result = await workspaceLoad(async () => {
    const repo = workspaceRepo();
    const client = await repo.getClient(id);
    if (!client) return null;
    const [returns, docs, messages, tasks, notes, invoices, stages, others, dependents, businesses, member, manualSpouse, events, work, pipelines, workflowTasks] = await Promise.all([
      repo.listReturns({ clientId: id }), repo.listDocs(id), repo.listMessages(id), repo.listTasks({ clientId: id }), repo.listNotes(id), repo.listInvoices({ clientId: id }), boardStages(),
      repo.listClients({ includeArchived: false }), repo.listDependents(id).catch(() => null), repo.listBusinesses(id).catch(() => null),
      portalMemberRepo(client.tenant_id).getForClient(id).catch(() => null), repo.getSpouse(id).catch(() => null), repo.listClientEvents(id, 200).catch(() => []), repo.listWork({ clientId: id }).catch(() => []), pipelinesRepo().list().catch(() => []),
      workflowTasksFor(id),
    ]);
    return { client, returns, docs, messages, tasks, notes, invoices, stages, others, dependents, businesses, member, manualSpouse, events, work, pipelines, workflowTasks };
  });
  if (result.ok && !result.data) notFound();
  if (!result.ok) return <><PageTitle title="Client" back={{ href: "/contacts", label: "Contacts" }} /><WorkspaceSetup message={result.message} /></>;
  const { client, returns, docs, messages, tasks: ownTasks, notes, invoices, stages, others, dependents, businesses, member, manualSpouse, events, work, pipelines, workflowTasks } = result.data!;
  const tasks: (ClientTask & { source?: "workflow" })[] = [...ownTasks, ...workflowTasks];
  // The office's own texting account, and its prepaid credits when it has them (tenant #1 pays Twilio directly).
  // The Documents tab: what was sent to this client and how it went, and which files they can see in the portal.
  const docsDeps = tab === "documents" ? documentDeps() : null;
  const sent = docsDeps ? await (async () => {
    const [deliveries, library] = await Promise.all([docsDeps.repo.listDeliveriesForClient(id, 50).catch(() => []), docsDeps.repo.listDocuments().catch(() => [])]);
    const names = new Map(library.map((d) => [d.id, d.name]));
    const signatures = await Promise.all(deliveries.map((d) => (d.kind === "signature" ? docsDeps.repo.getSignatureByDelivery(d.id).catch(() => null) : null)));
    return deliveries.map((d, i) => ({ d, name: names.get(d.document_id) ?? d.file_name, sig: signatures[i] }));
  })() : [];
  const sentForms = tab === "documents" ? await (async () => {
    const fd = formDeps();
    const [invites, list] = await Promise.all([fd.repo.listInvitesForClient(id, 50).catch(() => []), fd.repo.listForms().catch(() => [])]);
    const names = new Map(list.map((f) => [f.id, f.name]));
    return invites.map((i) => ({ i, name: names.get(i.form_id) ?? "Form", status: inviteStatus(i) }));
  })() : [];
  const sms = tab === "messages" ? await tenantSms().catch(() => null) : null;
  const credits = sms?.route.billing === "credits" ? await sms.repo.balance().catch(() => null) : null;
  const ssnOnFile = await hasStoredSsn(ssnDeps(), client.id).catch(() => false);
  const duplicates = tab === "overview" ? await loadContacts().then((d) => duplicatesOfClient(d.contacts, d.duplicates, client.id)).catch(() => []) : [];
  const sheetCtx = tab === "billing" ? await loadSheetContext() : null!;
  const invoicePlans = tab === "billing" ? await workspaceRepo().listInstallments(invoices.map((i) => i.id)).catch(() => []) : [];
  const invoicePayments = tab === "billing" ? await paymentsFor(workspaceRepo(), invoices.filter((i) => i.paid_cents > 0).map((i) => i.id)).catch(() => []) : [];
  const stageName = (sid: string) => stages.find((s) => s.id === sid)?.name ?? "Intake";
  // "2025 return", "2025 extension", "2025 amendment".
  const returnLabel = (r: { kind: keyof typeof RETURN_KINDS; tax_year: number }) => `${r.tax_year} ${r.kind === "original" ? "return" : r.kind}`;
  const newestFirst = [...returns].sort((a, b) => b.tax_year - a.tax_year);
  const owes = invoices.filter((i) => i.status === "sent").reduce((n, i) => n + balance(i), 0);
  const back = `/workspace/clients/${id}?tab=${tab}`;
  const openTasks = tasks.filter((x) => !x.done_at);
  const spouse = client.spouse_id ? others.find((o) => o.id === client.spouse_id) ?? null : null;
  const names = client.first_name ? { first: client.first_name, last: client.last_name ?? "" } : (() => { const s = splitName(client.full_name); return { first: s.first, last: s.last ?? "" }; })();
  const lastMessage = messages[0] ?? null;
  const portalLabel = !member ? "Not invited" : member.status === "active" ? "Active" : member.status === "invited" ? "Invited" : "Off";
  const hiddenTab = (HIDDEN as readonly string[]).includes(tab);
  const activity = events.map((e) => ({ id: e.id, text: describeEvent(e), by: typeof e.detail.by === "string" ? e.detail.by : e.actor_id ? "a teammate" : "the system", at: e.created_at })).filter((e): e is { id: string; text: string; by: string; at: string } => e.text !== null);
  const details: Details = {
    id: client.id, first_name: names.first, last_name: names.last, email: client.email ?? "", phone: client.phone ?? "", dob: client.dob ?? "", ssn_last4: client.ssn_last4, ssn_on_file: ssnOnFile,
    address_line1: client.address_line1 ?? "", address_line2: client.address_line2 ?? "", city: client.city ?? "", state: client.state ?? "", zip: client.zip ?? "", address: client.address ?? "",
    same_address: client.address_same_as_last_year !== false, prior_address_line1: client.prior_address_line1 ?? "", prior_address_line2: client.prior_address_line2 ?? "", prior_city: client.prior_city ?? "", prior_state: client.prior_state ?? "", prior_zip: client.prior_zip ?? "",
    dl_number: client.dl_number ?? "", dl_state: client.dl_state ?? "", dl_issued_on: client.dl_issued_on ?? "", dl_expires_on: client.dl_expires_on ?? "",
  };
  const quickAdd = (action: (f: FormData) => Promise<void>, field: string, placeholder: string, withDate: boolean) => (
    <form action={action} className="cl-quick">
      <input type="hidden" name="client_id" value={client.id} /><input type="hidden" name="back" value={back} />
      <input name={field} required maxLength={field === "body" ? 4000 : 200} placeholder={placeholder} aria-label={placeholder} />
      {withDate && <input name="due_on" type="date" aria-label="Due" />}
      <button className="monarch-secondary">{field === "body" ? "Save" : "Add"}</button>
    </form>
  );
  return (
    <>
      <PageTitle title={client.full_name} back={{ href: "/contacts", label: "Contacts" }}>
        {[client.email, client.phone].filter(Boolean).join(" · ") || "No contact details yet"}{client.archived_at ? " · Archived" : ""}
      </PageTitle>
      {(!member || member.status === "invited" || (member.status === "suspended" && !member.user_id)) && (
        <form action={invitePortalAction} className="cl-head-actions">
          <input type="hidden" name="area" value="admin" /><input type="hidden" name="client_id" value={client.id} />
          <button className="monarch-secondary" disabled={!client.email} title={client.email ? undefined : "Add an email address first"}>{member?.status === "invited" ? "Resend invite" : "Send invite"}</button>
        </form>
      )}
      <Flash notice={sp.notice} error={sp.error} />
      {duplicates.map((d) => (
        <div key={d.other.key} className="cl-dupe" role="note">
          <span><b>Possible duplicate:</b> <Link href={d.other.refs.clientId ? `/workspace/clients/${d.other.refs.clientId}` : `/contacts/${d.other.key}`} target="_blank" rel="noreferrer">{d.other.name}</Link> · {d.reason}</span>
          {(d.other.refs.clientId || d.other.refs.leadId) && (
            <Modal label="Merge" title={`Merge ${d.other.name}`} className="monarch-secondary">
              {d.other.refs.clientId ? (
                <form action={mergeClientsAction} className="monarch-form">
                  <MergeChoice thisId={client.id} thisName={client.full_name} otherId={d.other.refs.clientId} otherName={d.other.name} />
                  <div className="is-wide ac-actions"><button className="monarch-primary">Merge</button></div>
                </form>
              ) : (
                <form action={mergeLeadIntoClientAction} className="monarch-form">
                  <input type="hidden" name="client_id" value={client.id} /><input type="hidden" name="lead_id" value={d.other.refs.leadId ?? ""} />
                  <p className="is-wide">Keep {client.full_name} and fold the lead {d.other.name} into this client. The lead&apos;s details become a note here and the lead is marked converted.</p>
                  <div className="is-wide ac-actions"><button className="monarch-primary">Merge</button></div>
                </form>
              )}
            </Modal>
          )}
        </div>
      ))}
      <nav className="cl-tabs" aria-label="Client">
        {TABS.map(([k, label]) => <Link key={k} href={`/workspace/clients/${id}?tab=${k}`} className={k === tab ? "is-on" : undefined} aria-current={k === tab ? "page" : undefined}>{label}</Link>)}
      </nav>
      {hiddenTab && <p><Link className="monarch-link" href={`/workspace/clients/${id}`}>&larr; Back to overview</Link></p>}

      {tab === "overview" && (
        <>
          <section className="cl-strip" aria-label="At a glance">
            <div><small>Returns</small><b>{newestFirst.length ? `${returnLabel(newestFirst[0])} · ${stageName(newestFirst[0].stage_id)}` : "None"}</b></div>
            <div><small>Owes</small><b>{owes ? dollars(owes) : "Nothing"}</b></div>
            <div><small>Open tasks</small><b>{openTasks.length}</b></div>
            <div><small>Documents</small><b>{docs.length}</b></div>
            <div><small>Last message</small><b>{lastMessage ? `${CHANNELS[lastMessage.channel]} · ${when(lastMessage.occurred_at)}` : "None"}</b></div>
            <div><small>Portal</small><b>{portalLabel}</b></div>
          </section>
          <div className="grid2 cl-cols">
            <div className="cl-col">
              <DetailsCard d={details} />

              <section className="monarch-panel cl-card">
                <div className="cl-card-head"><h2>Tags</h2></div>
                <form action={saveClientTagsAction} className="cl-tags">
                  <input type="hidden" name="id" value={client.id} />
                  <TagInput initial={client.tags ?? []} suggestions={[...new Set(others.flatMap((o) => o.tags ?? []))].sort()} />
                  <button className="monarch-secondary">Save tags</button>
                </form>
              </section>

              <section className="monarch-panel cl-card">
                <div className="cl-card-head"><h2>Spouse</h2>
                  {!spouse && !manualSpouse && (
                    <span className="cl-card-actions">
                      <Modal label="Link a client" title="Link a client as spouse" className="monarch-secondary"><LinkSpouseForm clientId={client.id} clients={others.filter((o) => o.id !== client.id && !o.spouse_id).map((o) => ({ id: o.id, name: o.full_name }))} /></Modal>
                      <Modal label="Add spouse" title="Add a spouse" className="monarch-secondary"><SpouseForm clientId={client.id} s={null} filed={client.filed_with_spouse_last_year ?? null} /></Modal>
                    </span>
                  )}
                  {manualSpouse && <Modal label="Edit spouse" title="Edit spouse" className="monarch-secondary"><SpouseForm clientId={client.id} s={manualSpouse} filed={client.filed_with_spouse_last_year ?? null} /></Modal>}
                </div>
                {spouse ? (
                  <ul className="cl-list"><li>
                    <span><Link href={`/workspace/clients/${spouse.id}`}><b>{spouse.full_name}</b></Link>{client.filed_with_spouse_last_year !== null && client.filed_with_spouse_last_year !== undefined && <small className="monarch-subcell">Filed together last year: {client.filed_with_spouse_last_year ? "Yes" : "No"}</small>}</span>
                    <form action={unlinkSpouseAction}><input type="hidden" name="id" value={client.id} /><button className="monarch-link">Unlink</button></form>
                  </li></ul>
                ) : manualSpouse ? (
                  <ul className="cl-list"><li>
                    <span><b>{[manualSpouse.first_name, manualSpouse.last_name].filter(Boolean).join(" ")}</b>
                      <small className="monarch-subcell">{[manualSpouse.dob ? `born ${manualSpouse.dob}` : "", manualSpouse.phone, manualSpouse.email, manualSpouse.ssn_last4 ? `SSN ending ${manualSpouse.ssn_last4}` : ""].filter(Boolean).join(" · ") || "No other details"}</small>
                      {(manualSpouse.dl_number || manualSpouse.dl_state || manualSpouse.dl_issued_on || manualSpouse.dl_expires_on) && <small className="monarch-subcell">License: {[manualSpouse.dl_number, manualSpouse.dl_state, manualSpouse.dl_issued_on ? `issued ${manualSpouse.dl_issued_on}` : "", manualSpouse.dl_expires_on ? `expires ${manualSpouse.dl_expires_on}` : ""].filter(Boolean).join(" · ")}</small>}
                      {client.filed_with_spouse_last_year !== null && client.filed_with_spouse_last_year !== undefined && <small className="monarch-subcell">Filed together last year: {client.filed_with_spouse_last_year ? "Yes" : "No"}</small>}
                    </span>
                    <form action={removeSpouseAction}><input type="hidden" name="client_id" value={client.id} /><button className="monarch-link is-danger">Remove</button></form>
                  </li></ul>
                ) : <p className="monarch-muted cl-empty">None</p>}
              </section>

              {dependents && (
                <section className="monarch-panel cl-card">
                  <div className="cl-card-head"><h2>Dependents</h2>
                    <Modal label="Add dependent" title="Add a dependent" className="monarch-secondary">
                      <form action={addDependentAction} className="monarch-form">
                        <input type="hidden" name="client_id" value={client.id} />
                        <label>First name *<input name="first_name" required maxLength={100} /></label>
                        <label>Last name<input name="last_name" maxLength={100} defaultValue={names.last} /></label>
                        <label>Date of birth<input name="dob" type="date" /></label>
                        <label>Relationship<select name="relationship" defaultValue="child">{Object.entries(RELATIONSHIPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                        <label className="is-wide">Social Security number<FormattedInput kind="ssn" name="ssn" secret autoComplete="off" placeholder="Nine digits" /></label>
                        <div className="is-wide ac-actions"><button className="monarch-primary">Add dependent</button></div>
                      </form>
                    </Modal>
                  </div>
                  {dependents.length === 0 ? <p className="monarch-muted cl-empty">None</p> : (
                    <ul className="cl-list">{dependents.map((d) => (
                      <li key={d.id}><span><b>{[d.first_name, d.last_name].filter(Boolean).join(" ")}</b><small className="monarch-subcell">{RELATIONSHIPS[d.relationship]}{d.dob ? ` · born ${d.dob}` : ""}{d.ssn_last4 ? ` · SSN ending ${d.ssn_last4}` : ""}</small></span>
                        <form action={removeDependentAction}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="client_id" value={client.id} /><button className="monarch-link is-danger">Remove</button></form></li>
                    ))}</ul>
                  )}
                </section>
              )}

              {businesses && (
                <section className="monarch-panel cl-card">
                  <div className="cl-card-head"><h2>Business</h2>
                    <Modal label="Add business" title="Add a business" className="monarch-secondary">
                      <form action={addBusinessAction} className="monarch-form">
                        <input type="hidden" name="client_id" value={client.id} />
                        <label className="is-wide">Business name *<input name="name" required maxLength={200} /></label>
                        <label>Kind<select name="entity_type" defaultValue="sole_proprietor">{Object.entries(ENTITY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                        <label>EIN<FormattedInput kind="ein" name="ein" autoComplete="off" /></label>
                        <label>Business email<input name="email" type="email" maxLength={254} autoComplete="off" /></label>
                        <label>Business phone<FormattedInput kind="phone" name="phone" autoComplete="off" /></label>
                        <label className="is-wide">Address<input name="address" maxLength={300} /></label>
                        <div className="is-wide ac-actions"><button className="monarch-primary">Add business</button></div>
                      </form>
                    </Modal>
                  </div>
                  {businesses.length === 0 ? <p className="monarch-muted cl-empty">None</p> : (
                    <ul className="cl-list">{businesses.map((b) => (
                      <li key={b.id}><span><b>{b.name}</b><small className="monarch-subcell">{[ENTITY_TYPES[b.entity_type], b.ein ? `EIN ${b.ein}` : "", b.email, b.phone, b.address].filter(Boolean).join(" · ")}</small></span>
                        <form action={removeBusinessAction}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="client_id" value={client.id} /><button className="monarch-link is-danger">Remove</button></form></li>
                    ))}</ul>
                  )}
                </section>
              )}
            </div>

            <div className="cl-col">
              <section className="monarch-panel cl-card">
                <div className="cl-card-head"><h2>Returns</h2>
                  <span className="cl-card-actions">
                    <Modal label="Add return" title="Add a return" className="monarch-secondary"><AddReturnForm clientId={client.id} back={back} /></Modal>
                    {returns.length > FIVE && <Link className="monarch-link" href={`/workspace/clients/${id}?tab=returns`}>See all ({returns.length})</Link>}
                  </span>
                </div>
                {returns.length === 0 ? <p className="monarch-muted cl-empty">None</p> : (
                  <ul className="cl-list">{newestFirst.slice(0, FIVE).map((r) => (
                    <li key={r.id} id={`return-${r.id}`}><span><b>{returnLabel(r)}</b><small className="monarch-subcell">{stageName(r.stage_id)}</small></span>
                      <span className={r.due_on && r.due_on < today && r.stage_id !== stages[stages.length - 1].id ? "wb-late" : undefined}>{r.due_on ? `due ${r.due_on}` : ""}</span></li>
                  ))}</ul>
                )}
              </section>

              {work.length > 0 && (
                <section className="monarch-panel cl-card">
                  <div className="cl-card-head"><h2>Other work</h2></div>
                  <ul className="cl-list">{work.map((w) => {
                    const pl = pipelines.find((x) => x.id === w.pipeline_id);
                    return (
                      <li key={w.id}><span><b>{pl?.name ?? "Work"}{w.title ? `: ${w.title}` : ""}</b><small className="monarch-subcell">{pl?.stages.find((s) => s.id === w.stage_id)?.name ?? pl?.stages[0]?.name ?? ""}</small></span>
                        <span className={w.due_on && w.due_on < today ? "wb-late" : undefined}>{w.due_on ? `due ${w.due_on}` : ""}</span></li>
                    );
                  })}</ul>
                </section>
              )}

              <section className="monarch-panel cl-card">
                <div className="cl-card-head"><h2>Tasks</h2>{tasks.length > 0 && <Link className="monarch-link" href={`/workspace/clients/${id}?tab=tasks`}>See all ({tasks.length})</Link>}</div>
                {quickAdd(addTaskAction, "title", "Add a task", true)}
                {openTasks.length === 0 ? <p className="monarch-muted cl-empty">None open</p> : (
                  <ul className="cl-list">{openTasks.slice(0, FIVE).map((x) => (
                    <li key={x.id}><span><b>{x.title}</b>{x.due_on && <small className={`monarch-subcell${x.due_on < today ? " wb-late" : ""}`}>due {x.due_on}</small>}</span>
                      <form action={toggleTaskAction}><input type="hidden" name="id" value={x.id} />{x.source && <input type="hidden" name="source" value={x.source} />}<input type="hidden" name="back" value={back} /><input type="hidden" name="done" value="yes" /><button className="monarch-link">Done</button></form></li>
                  ))}</ul>
                )}
              </section>

              <section className="monarch-panel cl-card">
                <div className="cl-card-head"><h2>Notes</h2>{notes.length > 0 && <Link className="monarch-link" href={`/workspace/clients/${id}?tab=notes`}>See all ({notes.length})</Link>}</div>
                {quickAdd(addNoteAction, "body", "Add a note", false)}
                {notes.length === 0 ? <p className="monarch-muted cl-empty">None</p> : (
                  <ul className="cl-list">{notes.slice(0, FIVE).map((n) => <li key={n.id}><span style={{ whiteSpace: "pre-wrap" }}>{n.body}<small className="monarch-subcell">{when(n.created_at)}</small></span></li>)}</ul>
                )}
              </section>

              <section className="monarch-panel cl-card">
                <div className="cl-card-head"><h2>Client activity</h2>{activity.length > FIVE && <Link className="monarch-link" href={`/workspace/clients/${id}?tab=activity`}>See all ({activity.length})</Link>}</div>
                {activity.length === 0 ? <p className="monarch-muted cl-empty">Nothing recorded yet</p> : (
                  <ul className="cl-list">{activity.slice(0, FIVE).map((a) => <li key={a.id}><span>{a.text}<small className="monarch-subcell">{a.by} · {when(a.at)}</small></span></li>)}</ul>
                )}
              </section>

              <form action={archiveClientAction} className="monarch-inline-form cl-archive">
                <input type="hidden" name="id" value={client.id} />
                {client.archived_at && <input type="hidden" name="restore" value="yes" />}
                <button className="monarch-secondary">{client.archived_at ? "Restore client" : "Archive client"}</button>
              </form>
            </div>
          </div>
        </>
      )}

      {tab === "documents" && (
        <>
          <PortalPanel area="admin" mode="documents" part="actions" tab="documents" tenantId={client.tenant_id} clientId={client.id} email={client.email} signDocId={sp.sign} backHref={`/workspace/clients/${id}`}
            />
          {sent.length + sentForms.length > 0 && (
            <section className="monarch-panel">
              <div className="monarch-panel-head"><div><h2>Sent to {client.full_name.split(" ")[0]}</h2></div></div>
              <div className="monarch-table-wrap"><table>
                <thead><tr><th>NAME</th><th>HOW</th><th>STATUS</th><th>SENT</th><th /></tr></thead>
                <tbody>
                  {[
                    ...sent.map(({ d, name, sig }) => ({ at: d.created_at, row: (
                      <tr key={`d-${d.id}`}>
                        <td><Link href={`/documents/${d.document_id}?tab=sent`}><b>{name}</b></Link></td>
                        <td>{d.kind === "signature" ? "Document to sign" : "Document to read"}</td>
                        <td>{d.revoked_at ? "Cancelled" : sig?.status === "signed" ? `Signed ${when(sig.signed_at)}` : sig?.status === "declined" ? "Declined" : sig?.status === "viewed" || d.first_opened_at ? "Opened" : "Not opened yet"}</td>
                        <td>{when(d.created_at)}</td>
                        <td />
                      </tr>) })),
                    ...sentForms.map(({ i, name, status }) => ({ at: i.created_at, row: (
                      <tr key={`f-${i.id}`}>
                        <td><b>{name}</b></td>
                        <td>Form</td>
                        <td>{status === "completed" ? "Completed" : status === "opened" ? "Opened" : status === "sent" ? "Not opened yet" : status === "expired" ? "Link expired" : "Cancelled"}</td>
                        <td>{when(i.created_at)}</td>
                        <td>{(status === "sent" || status === "opened") && <form action={cancelFormInviteAction}><input type="hidden" name="area" value="admin" /><input type="hidden" name="client_id" value={client.id} /><input type="hidden" name="invite_id" value={i.id} /><button className="monarch-link is-danger">Cancel</button></form>}</td>
                      </tr>) })),
                  ].sort((x, y) => y.at.localeCompare(x.at)).map((r) => r.row)}
                </tbody>
              </table></div>
            </section>
          )}
          <ClientDrive clientId={client.id} folderId={sp.folder} base={`/workspace/clients/${client.id}?tab=documents`} />
          <PortalPanel area="admin" mode="documents" part="lists" tab="documents" tenantId={client.tenant_id} clientId={client.id} email={client.email} signDocId={sp.sign} backHref={`/workspace/clients/${id}`} />
        </>
      )}

      {tab === "messages" && (() => {
        const emailProblem = emailKeyProblems(emailConfig(process.env))[0] ?? null;
        const smsProblem = !sms ? "Text messaging could not be checked." : sms.route.ok ? null : sms.route.problem;
        const mobile = toE164(client.phone);
        return (
        <>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <div className="cl-card-head"><h2>Send a message</h2>
              <Modal label="Log a message sent elsewhere" title="Log a message" className="monarch-secondary">
                <form action={logMessageAction} className="monarch-form">
                  <input type="hidden" name="client_id" value={client.id} />
                  <label>Direction<select name="direction" defaultValue="out"><option value="out">I sent it</option><option value="in">Client sent it</option></select></label>
                  <label>How<select name="channel" defaultValue="email">{Object.entries(CHANNELS).filter(([k]) => k !== "portal").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Date<input name="occurred_at" type="date" defaultValue={today} /></label>
                  <label>Subject (optional)<input name="subject" maxLength={200} /></label>
                  <label className="is-wide">What was said *<textarea name="body" required rows={4} maxLength={4000} /></label>
                  <div className="is-wide ac-actions"><button className="monarch-primary">Log message</button></div>
                </form>
              </Modal>
            </div>
            {client.archived_at ? <p className="monarch-muted">This client is archived. Restore them to send messages.</p> : (
              <MessageComposer
                clientId={client.id}
                email={{ to: client.email, problem: !client.email ? "Add an email address on the Overview tab to email this client." : emailProblem ? `Email sending isn't set up yet: ${emailProblem}` : null }}
                sms={{ to: mobile, problem: !mobile ? "Add a mobile number on the Overview tab to text this client." : smsProblem ? `Text messaging isn't connected yet: ${smsProblem}` : null }}
                portal={{ to: member?.email ?? null, problem: !member || member.status !== "active" ? "This client doesn't have portal access yet. Use Send invite at the top of this page." : null }}
                credits={credits}
              />
            )}
          </section>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>History</h2></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>WHEN</th><th>HOW</th><th>MESSAGE</th><th>STATUS</th></tr></thead>
              <tbody>
                {messages.length === 0 ? <EmptyRow colSpan={4}>No messages yet.</EmptyRow> : messages.map((m) => (
                  <tr key={m.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{when(m.occurred_at)}</td>
                    <td>{m.direction === "in" ? "From client" : "To client"} · {CHANNELS[m.channel]}{m.sent_to && <small className="monarch-subcell">{m.sent_to}{m.segments ? ` · ${m.segments} segment${m.segments > 1 ? "s" : ""}` : ""}</small>}</td>
                    <td style={{ whiteSpace: "pre-wrap" }}>{m.subject && <b>{m.subject}<br /></b>}{m.body}</td>
                    <td>{m.status === "sent" ? <Badge value="sent" /> : m.status === "failed" ? <><Badge value="failed" />{m.error && <small className="monarch-subcell">{m.error}</small>}</> : <span className="monarch-muted">Logged</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
        </>
        );
      })()}

      {tab === "billing" && (
        <>
          <div className="cl-head-actions"><NewInvoice back={back} year={new Date().getUTCFullYear() - 1} clientId={client.id} returns={returns.map((r) => ({ id: r.id, label: returnLabel(r) }))} /></div>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Billing</h2><p>{owes ? `${dollars(owes)} owed.` : "Nothing owed."}</p></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>INVOICE</th><th>YEAR</th><th>TOTAL</th><th>PAID</th><th>STATUS</th><th>PAYMENT TYPE</th><th></th></tr></thead>
              <tbody>
                {invoices.filter((i) => !i.archived_at).length === 0 ? <EmptyRow colSpan={7}>No invoices yet.</EmptyRow> : invoices.filter((i) => !i.archived_at).map((i) => {
                  const view = invoiceView(i, today);
                  return (
                    <tr key={i.id}>
                      <td><b><InvoiceLink invoice={i} clientName={client.full_name} ctx={sheetCtx} payments={invoicePayments.filter((x) => x.invoice_id === i.id)} plan={invoicePlans.filter((x) => x.invoice_id === i.id)} /></b><small className="monarch-subcell">issued {i.issued_on}{i.due_on ? ` · due ${i.due_on}` : ""}</small></td>
                      <td>{i.tax_year}</td>
                      <td><b>{dollars(i.total_cents)}</b></td>
                      <td>{dollars(i.paid_cents)}</td>
                      <td><Badge value={view} /></td>
                      <td>{i.payer ? PAYERS[i.payer] : "—"}</td>
                      <td><InvoiceActions invoice={i} plan={invoicePlans.filter((x) => x.invoice_id === i.id)} back={back} today={today} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </section>
        </>
      )}

      {tab === "returns" && (
        <>
          <div className="cl-head-actions"><Modal label="Add return" title="Add a return" className="monarch-primary"><AddReturnForm clientId={client.id} back={back} /></Modal></div>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Returns</h2></div><Link className="mt-card-link" href="/workspace/work">Open the board</Link></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>RETURN</th><th>STAGE</th><th>DUE</th><th>FILED</th></tr></thead>
              <tbody>
                {newestFirst.length === 0 ? <EmptyRow colSpan={4}>No returns yet.</EmptyRow> : newestFirst.map((r) => (
                  <tr key={r.id} id={`return-${r.id}`}><td><b>{returnLabel(r)}</b></td><td>{stageName(r.stage_id)}</td><td className={r.due_on && r.due_on < today && r.stage_id !== stages[stages.length - 1].id ? "wb-late" : undefined}>{r.due_on ?? "—"}</td><td>{r.filed_on ?? "—"}</td></tr>
                ))}
              </tbody>
            </table></div>
          </section>
        </>
      )}

      {tab === "tasks" && (
        <>
          <section className="monarch-panel cl-card"><h2 style={{ marginTop: 0 }}>Add a task</h2>
            <form action={addTaskAction} className="cl-quick">
              <input type="hidden" name="client_id" value={client.id} /><input type="hidden" name="back" value={back} />
              <input name="title" required maxLength={200} placeholder="Task" aria-label="Task" />
              <input name="due_on" type="date" aria-label="Due" />
              <select name="return_id" defaultValue="" aria-label="Which return is this for?"><option value="">No specific return</option>{newestFirst.map((r) => <option key={r.id} value={r.id}>{returnLabel(r)}</option>)}</select>
              <button className="monarch-secondary">Add</button>
            </form>
          </section>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Tasks</h2></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>TASK</th><th>DUE</th><th>RETURN</th><th></th></tr></thead>
              <tbody>
                {tasks.length === 0 ? <EmptyRow colSpan={4}>No tasks yet.</EmptyRow> : tasks.map((x) => (
                  <tr key={x.id} style={x.done_at ? { opacity: 0.55 } : undefined}>
                    <td style={x.done_at ? { textDecoration: "line-through" } : undefined}><b>{x.title}</b></td>
                    <td className={!x.done_at && x.due_on && x.due_on < today ? "wb-late" : undefined}>{x.due_on ?? "—"}</td>
                    <td>{x.return_id ? (() => { const r = returns.find((y) => y.id === x.return_id); return r ? returnLabel(r) : "—"; })() : "—"}</td>
                    <td><form action={toggleTaskAction}><input type="hidden" name="id" value={x.id} />{x.source && <input type="hidden" name="source" value={x.source} />}<input type="hidden" name="back" value={back} /><input type="hidden" name="done" value={x.done_at ? "no" : "yes"} /><button className="monarch-link">{x.done_at ? "Reopen" : "Done"}</button></form></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
        </>
      )}

      {tab === "notes" && (
        <>
          <section className="monarch-panel cl-card"><h2 style={{ marginTop: 0 }}>Add a note</h2>{quickAdd(addNoteAction, "body", "Note", false)}</section>
          <section className="monarch-panel">
            <div className="monarch-table-wrap"><table><tbody>
              {notes.length === 0 ? <EmptyRow colSpan={2}>No notes yet.</EmptyRow> : notes.map((n) => <tr key={n.id}><td style={{ whiteSpace: "nowrap", verticalAlign: "top" }}>{when(n.created_at)}</td><td style={{ whiteSpace: "pre-wrap" }}>{n.body}</td></tr>)}
            </tbody></table></div>
          </section>
        </>
      )}

      {tab === "activity" && (
        <section className="monarch-panel">
          <div className="monarch-panel-head"><div><h2>Client activity</h2></div></div>
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>WHEN</th><th>WHAT</th><th>BY</th></tr></thead>
            <tbody>
              {activity.length === 0 ? <EmptyRow colSpan={3}>Nothing recorded yet.</EmptyRow> : activity.map((a) => <tr key={a.id}><td style={{ whiteSpace: "nowrap" }}>{when(a.at)}</td><td>{a.text}</td><td>{a.by}</td></tr>)}
            </tbody>
          </table></div>
        </section>
      )}
    </>
  );
}

function AddReturnForm({ clientId, back }: { clientId: string; back: string }) {
  return (
    <form action={addReturnAction} className="monarch-form">
      <input type="hidden" name="client_id" value={clientId} /><input type="hidden" name="back" value={back} />
      <label>Tax year *<input name="tax_year" required inputMode="numeric" maxLength={4} defaultValue={new Date().getUTCFullYear() - 1} /></label>
      <label>Kind<select name="kind" defaultValue="original">{Object.entries(RETURN_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="is-wide">Due date<input name="due_on" type="date" /></label>
      <div className="is-wide ac-actions"><button className="monarch-primary">Add return</button></div>
    </form>
  );
}

function LinkSpouseForm({ clientId, clients }: { clientId: string; clients: { id: string; name: string }[] }) {
  return (
    <form action={linkSpouseAction} className="monarch-form">
      <input type="hidden" name="id" value={clientId} />
      <label className="is-wide">Client<select name="spouse_id" required defaultValue=""><option value="" disabled>Choose a client…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <FiledLastYear filed={null} />
      <div className="is-wide ac-actions"><button className="monarch-primary">Link</button></div>
    </form>
  );
}

function FiledLastYear({ filed }: { filed: boolean | null }) {
  return (
    <fieldset className="is-wide dc-same">
      <legend>Did you file with this spouse last year?</legend>
      <label className="monarch-check"><input type="radio" name="filed_last_year" value="yes" defaultChecked={filed === true} /> Yes</label>
      <label className="monarch-check"><input type="radio" name="filed_last_year" value="no" defaultChecked={filed === false} /> No</label>
    </fieldset>
  );
}

function SpouseForm({ clientId, s, filed }: { clientId: string; s: { first_name: string; last_name: string | null; dob: string | null; phone: string | null; email: string | null; dl_number?: string | null; dl_state?: string | null; dl_issued_on?: string | null; dl_expires_on?: string | null } | null; filed: boolean | null }) {
  return (
    <form action={saveSpouseAction} className="monarch-form">
      <input type="hidden" name="client_id" value={clientId} />
      <label>First name *<input name="first_name" required maxLength={100} defaultValue={s?.first_name ?? ""} /></label>
      <label>Last name<input name="last_name" maxLength={100} defaultValue={s?.last_name ?? ""} /></label>
      <label>Date of birth<input name="dob" type="date" defaultValue={s?.dob ?? ""} /></label>
      <label>Phone<FormattedInput kind="phone" name="phone" defaultValue={s?.phone ?? ""} /></label>
      <label>Email<input name="email" type="email" maxLength={254} defaultValue={s?.email ?? ""} /></label>
      <label>Social Security number<FormattedInput kind="ssn" name="ssn" secret autoComplete="off" placeholder={s ? "Leave empty to keep" : "Nine digits"} /></label>
      <h3 className="is-wide dc-sub">Driver&apos;s license</h3>
      <label>License number<input name="dl_number" maxLength={40} defaultValue={s?.dl_number ?? ""} autoComplete="off" /></label>
      <label>State issued<StateSelect name="dl_state" defaultValue={s?.dl_state ?? ""} label="State that issued the license" /></label>
      <label>Issue date<input name="dl_issued_on" type="date" defaultValue={s?.dl_issued_on ?? ""} /></label>
      <label>Expiration date<input name="dl_expires_on" type="date" defaultValue={s?.dl_expires_on ?? ""} /></label>
      <FiledLastYear filed={filed} />
      <div className="is-wide ac-actions"><button className="monarch-primary">Save spouse</button></div>
    </form>
  );
}
