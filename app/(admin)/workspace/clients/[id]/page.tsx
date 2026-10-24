import { FormattedInput } from "@/components/forms/formatted-input";
import { PortalPanel } from "@/components/portal/panel";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, EmptyRow, Flash, PageTitle, when } from "@/components/admin/ui";
import { ClientDocUpload } from "@/components/workspace/client-doc-upload";
import { RevealSsn } from "@/components/workspace/reveal-ssn";
import { Modal } from "@/components/ui/modal";
import { MessageComposer } from "@/components/contacts/message-composer";
import { portalMemberRepo } from "@/lib/portal/server";
import { splitName } from "@/lib/workspace/rules.ts";
import { ENTITY_TYPES, RELATIONSHIPS } from "@/lib/workspace/types.ts";
import { hasStoredSsn } from "@/lib/ssn/service.ts";
import { ssnDeps } from "@/lib/ssn/server";
import { balance, defaultInvoiceLines, dollars, invoiceView } from "@/lib/workspace/rules.ts";
import { RETURN_KINDS } from "@/lib/workspace/types.ts";
import { boardStages, todayIso, workspaceLoad, workspaceRepo } from "@/lib/workspace/load";
import { addBusinessAction, addDependentAction, addNoteAction, addReturnAction, addTaskAction, archiveClientAction, createInvoiceAction, linkSpouseAction, removeBusinessAction, removeDependentAction, unlinkSpouseAction, deleteClientDocAction, invoiceStatusAction, logMessageAction, openClientDocAction, saveClientAction, toggleTaskAction } from "../../actions";
import { toE164 } from "@/lib/automation/twilio.ts";
import { tenantSms } from "@/lib/sms/server";
import { emailConfig, emailKeyProblems } from "@/lib/automation/email.ts";
import { WorkspaceSetup } from "../../setup";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Tasks, Notes and Portal are reached from the Overview (See all, and the Portal button), so they are not in the tab bar.
const TABS = [["overview", "Overview"], ["documents", "Documents"], ["messages", "Messages"], ["billing", "Billing"]] as const;
const HIDDEN = ["tasks", "notes", "portal"] as const;
const CHANNELS = { email: "Email", sms: "Text", call: "Call", other: "Other", portal: "Portal" } as const;

/** One client: overview, documents, messages, work, billing (with the $223 breakdown), tasks and notes. */
export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; sign?: string; notice?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const tab = TABS.some(([k]) => k === sp.tab) || (HIDDEN as readonly string[]).includes(sp.tab ?? "") ? sp.tab! : "overview";
  const today = todayIso();
  const result = await workspaceLoad(async () => {
    const repo = workspaceRepo();
    const client = await repo.getClient(id);
    if (!client) return null;
    const [returns, docs, messages, tasks, notes, invoices, stages, others, dependents, businesses, member] = await Promise.all([repo.listReturns({ clientId: id }), repo.listDocs(id), repo.listMessages(id), repo.listTasks({ clientId: id }), repo.listNotes(id), repo.listInvoices({ clientId: id }), boardStages(), repo.listClients({ includeArchived: false }), repo.listDependents(id).catch(() => null), repo.listBusinesses(id).catch(() => null), portalMemberRepo(client.tenant_id).getForClient(id).catch(() => null)]);
    return { client, returns, docs, messages, tasks, notes, invoices, stages, others, dependents, businesses, member };
  });
  if (result.ok && !result.data) notFound();
  if (!result.ok) return <><PageTitle title="Client" back={{ href: "/workspace/clients", label: "Clients" }} /><WorkspaceSetup message={result.message} /></>;
  const { client, returns, docs, messages, tasks, notes, invoices, stages, others, dependents, businesses, member } = result.data!;
  // The office's own texting account, and its prepaid credits when it has them (tenant #1 pays Twilio directly).
  const sms = tab === "messages" ? await tenantSms().catch(() => null) : null;
  const credits = sms?.route.billing === "credits" ? await sms.repo.balance().catch(() => null) : null;
  const ssnOnFile = await hasStoredSsn(ssnDeps(), client.id).catch(() => false);
  const stageName = (sid: string) => stages.find((s) => s.id === sid)?.name ?? "Intake";
  const returnLabel = (r: { kind: keyof typeof RETURN_KINDS; tax_year: number }) => `${RETURN_KINDS[r.kind]} ${r.tax_year}`;
  const owes = invoices.filter((i) => i.status === "sent").reduce((n, i) => n + balance(i), 0);
  const back = `/workspace/clients/${id}?tab=${tab}`;
  const openTasks = tasks.filter((x) => !x.done_at);
  const spouse = client.spouse_id ? others.find((o) => o.id === client.spouse_id) ?? null : null;
  const nameParts = client.first_name ? { first: client.first_name, last: client.last_name ?? "" } : (() => { const s = splitName(client.full_name); return { first: s.first, last: s.last ?? "" }; })();
  const lastMessage = messages[0] ?? null;
  const portalLabel = !member ? "Not invited" : member.status === "active" ? "Active" : member.status === "invited" ? "Invited" : "Off";
  const hiddenTab = (HIDDEN as readonly string[]).includes(tab);
  return (
    <>
      <PageTitle title={client.full_name} back={{ href: "/contacts", label: "Contacts" }}>
        {[client.email, client.phone].filter(Boolean).join(" · ") || "No contact details yet"}{client.archived_at ? " · Archived" : ""}
      </PageTitle>
      <div className="cl-head-actions"><Link className="monarch-secondary" href={`/workspace/clients/${id}?tab=portal`}>Portal</Link></div>
      <Flash notice={sp.notice} error={sp.error} />
      <nav className="cl-tabs" aria-label="Client">
        {TABS.map(([k, label]) => <Link key={k} href={`/workspace/clients/${id}?tab=${k}`} className={k === tab ? "is-on" : undefined} aria-current={k === tab ? "page" : undefined}>{label}</Link>)}
      </nav>
      {hiddenTab && <p><Link className="monarch-link" href={`/workspace/clients/${id}`}>&larr; Back to overview</Link></p>}

      {tab === "overview" && (
        <>
          <section className="cl-strip" aria-label="At a glance">
            <div><small>Returns</small><b>{returns.length ? `${returnLabel(returns[returns.length - 1])} · ${stageName(returns[returns.length - 1].stage_id)}` : "None"}</b></div>
            <div><small>Owes</small><b>{owes ? dollars(owes) : "Nothing"}</b></div>
            <div><small>Open tasks</small><b>{openTasks.length}</b></div>
            <div><small>Documents</small><b>{docs.length}</b></div>
            <div><small>Last message</small><b>{lastMessage ? `${CHANNELS[lastMessage.channel]} · ${when(lastMessage.occurred_at)}` : "None"}</b></div>
            <div><small>Portal</small><b>{portalLabel}</b></div>
          </section>
          <div className="grid2 cl-cols">
            <div className="cl-col">
              <form action={saveClientAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
                <h2 className="is-wide">Details</h2>
                <input type="hidden" name="id" value={client.id} />
                <label>First name *<input name="first_name" required maxLength={100} defaultValue={nameParts.first} /></label>
                <label>Last name *<input name="last_name" required maxLength={100} defaultValue={nameParts.last} /></label>
                <label>Email<input name="email" type="email" maxLength={254} defaultValue={client.email ?? ""} /></label>
                <label>Phone<FormattedInput kind="phone" name="phone" defaultValue={client.phone ?? ""} /></label>
                <label>Date of birth<input name="dob" type="date" defaultValue={client.dob ?? ""} /></label>
                <input type="hidden" name="ssn_last4" value={client.ssn_last4 ?? ""} />
                <div className="is-wide"><span>Social Security number or ITIN</span><RevealSsn clientId={client.id} last4={client.ssn_last4} onFile={ssnOnFile} /></div>
                <label className="is-wide">Street address<input name="address_line1" maxLength={150} defaultValue={client.address_line1 ?? (client.address_line1 === undefined || client.address_line1 === null ? client.address ?? "" : "")} /></label>
                <label className="is-wide">Apt, suite or unit<input name="address_line2" maxLength={100} defaultValue={client.address_line2 ?? ""} /></label>
                <label>City<input name="city" maxLength={80} defaultValue={client.city ?? ""} /></label>
                <label>State<input name="state" maxLength={2} defaultValue={client.state ?? ""} style={{ textTransform: "uppercase" }} /></label>
                <label>ZIP<FormattedInput kind="zip" name="zip" defaultValue={client.zip ?? ""} /></label>
                <div className="is-wide"><button className="monarch-primary">Save</button></div>
              </form>

              <section className="monarch-panel cl-card">
                <div className="cl-card-head"><h2>Spouse</h2></div>
                {spouse ? (
                  <form action={unlinkSpouseAction} className="cl-row"><input type="hidden" name="id" value={client.id} /><Link href={`/workspace/clients/${spouse.id}`}><b>{spouse.full_name}</b></Link><button className="monarch-link">Unlink</button></form>
                ) : (
                  <form action={linkSpouseAction} className="cl-row">
                    <input type="hidden" name="id" value={client.id} />
                    <select name="spouse_id" required defaultValue="" aria-label="Spouse"><option value="" disabled>Choose a client…</option>{others.filter((o) => o.id !== client.id && !o.spouse_id).map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}</select>
                    <button className="monarch-secondary">Link</button>
                  </form>
                )}
              </section>

              {dependents && (
                <section className="monarch-panel cl-card">
                  <div className="cl-card-head"><h2>Dependents</h2>
                    <Modal label="Add dependent" title="Add a dependent" className="monarch-secondary">
                      <form action={addDependentAction} className="monarch-form">
                        <input type="hidden" name="client_id" value={client.id} />
                        <label>First name *<input name="first_name" required maxLength={100} /></label>
                        <label>Last name<input name="last_name" maxLength={100} defaultValue={nameParts.last} /></label>
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
                        <label>Phone<FormattedInput kind="phone" name="phone" autoComplete="off" /></label>
                        <label className="is-wide">Address<input name="address" maxLength={300} /></label>
                        <div className="is-wide ac-actions"><button className="monarch-primary">Add business</button></div>
                      </form>
                    </Modal>
                  </div>
                  {businesses.length === 0 ? <p className="monarch-muted cl-empty">None</p> : (
                    <ul className="cl-list">{businesses.map((b) => (
                      <li key={b.id}><span><b>{b.name}</b><small className="monarch-subcell">{ENTITY_TYPES[b.entity_type]}{b.ein ? ` · EIN ${b.ein}` : ""}{b.phone ? ` · ${b.phone}` : ""}{b.address ? ` · ${b.address}` : ""}</small></span>
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
                    <Link className="monarch-link" href="/workspace/work">Open the board</Link>
                    <Modal label="Add return" title="Add a return" className="monarch-secondary">
                      <form action={addReturnAction} className="monarch-form">
                        <input type="hidden" name="client_id" value={client.id} /><input type="hidden" name="back" value={back} />
                        <label>Tax year *<input name="tax_year" required inputMode="numeric" maxLength={4} defaultValue={new Date().getUTCFullYear() - 1} /></label>
                        <label>Kind<select name="kind" defaultValue="original">{Object.entries(RETURN_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                        <label className="is-wide">Due date<input name="due_on" type="date" /></label>
                        <div className="is-wide ac-actions"><button className="monarch-primary">Add return</button></div>
                      </form>
                    </Modal>
                  </span>
                </div>
                {returns.length === 0 ? <p className="monarch-muted cl-empty">None</p> : (
                  <ul className="cl-list">{returns.map((r) => (
                    <li key={r.id} id={`return-${r.id}`}><span><b>{returnLabel(r)}</b><small className="monarch-subcell">{stageName(r.stage_id)}</small></span>
                      <span className={r.due_on && r.due_on < today && r.stage_id !== stages[stages.length - 1].id ? "wb-late" : undefined}>{r.due_on ? `due ${r.due_on}` : ""}</span></li>
                  ))}</ul>
                )}
              </section>

              <section className="monarch-panel cl-card">
                <div className="cl-card-head"><h2>Tasks</h2><Link className="monarch-link" href={`/workspace/clients/${id}?tab=tasks`}>See all ({tasks.length})</Link></div>
                {openTasks.length === 0 ? <p className="monarch-muted cl-empty">None open</p> : (
                  <ul className="cl-list">{openTasks.slice(0, 5).map((x) => (
                    <li key={x.id}><span><b>{x.title}</b>{x.due_on && <small className={`monarch-subcell${x.due_on < today ? " wb-late" : ""}`}>due {x.due_on}</small>}</span>
                      <form action={toggleTaskAction}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="back" value={back} /><input type="hidden" name="done" value="yes" /><button className="monarch-link">Done</button></form></li>
                  ))}</ul>
                )}
                <form action={addTaskAction} className="cl-quick">
                  <input type="hidden" name="client_id" value={client.id} />
                  <input name="title" required maxLength={200} placeholder="Add a task" aria-label="Task" />
                  <input name="due_on" type="date" aria-label="Due" />
                  <button className="monarch-secondary">Add</button>
                </form>
              </section>

              <section className="monarch-panel cl-card">
                <div className="cl-card-head"><h2>Notes</h2><Link className="monarch-link" href={`/workspace/clients/${id}?tab=notes`}>See all ({notes.length})</Link></div>
                {notes.length === 0 ? <p className="monarch-muted cl-empty">None</p> : (
                  <ul className="cl-list">{notes.slice(0, 3).map((n) => <li key={n.id}><span style={{ whiteSpace: "pre-wrap" }}>{n.body}<small className="monarch-subcell">{when(n.created_at)}</small></span></li>)}</ul>
                )}
                <form action={addNoteAction} className="cl-quick">
                  <input type="hidden" name="client_id" value={client.id} />
                  <input name="body" required maxLength={4000} placeholder="Add a note" aria-label="Note" />
                  <button className="monarch-secondary">Save</button>
                </form>
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
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Documents</h2><p>Kept in private storage. Each download link lasts one minute.</p></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>TITLE</th><th>FOR</th><th>TYPE</th><th>ADDED</th><th></th></tr></thead>
              <tbody>
                {docs.length === 0 ? <EmptyRow colSpan={5}>No documents yet.</EmptyRow> : docs.map((d) => (
                  <tr key={d.id}>
                    <td><b>{d.title}</b></td>
                    <td>{d.return_id ? (() => { const r = returns.find((x) => x.id === d.return_id); return r ? returnLabel(r) : "—"; })() : "The client"}</td>
                    <td>{d.file_type.toUpperCase()}</td>
                    <td>{when(d.created_at)}</td>
                    <td style={{ display: "flex", gap: 8 }}>
                      <form action={openClientDocAction}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="client_id" value={client.id} /><button className="monarch-link">Download</button></form>
                      <form action={deleteClientDocAction}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="client_id" value={client.id} /><button className="monarch-link is-danger">Delete</button></form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
          <section className="monarch-panel" style={{ padding: 20 }}><h2>Add a document</h2><ClientDocUpload clientId={client.id} returns={returns.map((r) => ({ id: r.id, label: returnLabel(r) }))} /></section>
        </>
      )}

      {tab === "messages" && (() => {
        const emailProblem = emailKeyProblems(emailConfig(process.env))[0] ?? null;
        const smsProblem = !sms ? "Text messaging could not be checked." : sms.route.ok ? null : sms.route.problem;
        const mobile = toE164(client.phone);
        return (
        <>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2>Send a message</h2>
            {client.archived_at ? <p className="monarch-muted">This client is archived. Restore them to send messages.</p> : (
              <MessageComposer
                clientId={client.id}
                email={{ to: client.email, problem: !client.email ? "Add an email address on the Overview tab to email this client." : emailProblem ? `Email sending isn't set up yet: ${emailProblem}` : null }}
                sms={{ to: mobile, problem: !mobile ? "Add a mobile number on the Overview tab to text this client." : smsProblem ? `Text messaging isn't connected yet: ${smsProblem}` : null }}
                portal={{ to: member?.email ?? null, problem: !member || member.status !== "active" ? "This client doesn't have portal access yet. Use the Portal button to invite them." : null }}
                credits={credits}
              />
            )}
          </section>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>History</h2><p>Messages sent from here, and messages you logged.</p></div></div>
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
          <form action={logMessageAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
            <h2 className="is-wide">Log a message sent elsewhere</h2>
            <input type="hidden" name="client_id" value={client.id} />
            <label>Direction<select name="direction" defaultValue="out"><option value="out">I sent it</option><option value="in">Client sent it</option></select></label>
            <label>How<select name="channel" defaultValue="email">{Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Date<input name="occurred_at" type="date" defaultValue={today} /></label>
            <label>Subject (optional)<input name="subject" maxLength={200} /></label>
            <label className="is-wide">What was said *<textarea name="body" required rows={4} maxLength={4000} /></label>
            <div className="is-wide"><button className="monarch-primary">Log message</button></div>
          </form>
        </>
        );
      })()}

      {tab === "billing" && (
        <>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Billing</h2><p>{owes ? `${dollars(owes)} owed.` : "Nothing owed."} Invoices default to the $223 breakdown.</p></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>INVOICE</th><th>YEAR</th><th>BREAKDOWN</th><th>TOTAL</th><th>PAID</th><th>STATUS</th><th></th></tr></thead>
              <tbody>
                {invoices.length === 0 ? <EmptyRow colSpan={7}>No invoices yet.</EmptyRow> : invoices.map((i) => {
                  const view = invoiceView(i, today);
                  return (
                    <tr key={i.id}>
                      <td><b>{i.number}</b><small className="monarch-subcell">issued {i.issued_on}{i.due_on ? ` · due ${i.due_on}` : ""}</small></td>
                      <td>{i.tax_year}</td>
                      <td style={{ whiteSpace: "normal" }}>{i.lines.map((l) => <div key={l.label}>{l.label} {dollars(l.amount_cents)}</div>)}</td>
                      <td><b>{dollars(i.total_cents)}</b></td>
                      <td>{dollars(i.paid_cents)}</td>
                      <td><Badge value={view} /></td>
                      <td>
                        <form action={invoiceStatusAction} className="monarch-inline-form" style={{ flexWrap: "wrap" }}>
                          <input type="hidden" name="id" value={i.id} /><input type="hidden" name="back" value={back} />
                          {i.status !== "paid" && i.status !== "void" && <><input name="amount" placeholder="Amount received" aria-label="Amount received" size={10} defaultValue={(balance(i) / 100).toFixed(2)} /><button name="do" value="pay" className="monarch-link">Record payment</button></>}
                          {i.status === "draft" && <button name="do" value="send" className="monarch-link">Send to client</button>}
                          {i.status !== "void" && i.paid_cents === 0 && <button name="do" value="void" className="monarch-link is-danger">Void</button>}
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </section>
          <form action={createInvoiceAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
            <h2 className="is-wide">New invoice</h2>
            <input type="hidden" name="client_id" value={client.id} /><input type="hidden" name="back" value={back} />
            <label>Tax year *<input name="tax_year" required inputMode="numeric" maxLength={4} defaultValue={new Date().getUTCFullYear() - 1} /></label>
            <label>For return<select name="return_id" defaultValue=""><option value="">None in particular</option>{returns.map((r) => <option key={r.id} value={r.id}>{returnLabel(r)}</option>)}</select></label>
            <label>Due date<input name="due_on" type="date" /></label>
            <label>Status<select name="status" defaultValue="sent"><option value="sent">Sent</option><option value="draft">Draft</option></select></label>
            <fieldset className="is-wide"><legend>Lines (the $223 breakdown; change any amount)</legend>
              {defaultInvoiceLines().concat([{ label: "", amount_cents: 0 }, { label: "", amount_cents: 0 }]).map((l, n) => (
                <span key={n} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <input name={`line_label_${n}`} defaultValue={l.label} placeholder="Description" aria-label={`Line ${n + 1} description`} maxLength={120} />
                  <input name={`line_amount_${n}`} defaultValue={l.label ? (l.amount_cents / 100).toFixed(2) : ""} placeholder="Amount" aria-label={`Line ${n + 1} amount`} size={10} />
                </span>
              ))}
            </fieldset>
            <label className="is-wide">Notes<input name="notes" maxLength={1000} /></label>
            <div className="is-wide"><button className="monarch-primary">Create invoice</button></div>
          </form>
        </>
      )}

      {tab === "tasks" && (
        <>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Tasks</h2></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>TASK</th><th>DUE</th><th>FOR</th><th></th></tr></thead>
              <tbody>
                {tasks.length === 0 ? <EmptyRow colSpan={4}>No tasks yet.</EmptyRow> : tasks.map((t) => (
                  <tr key={t.id} style={t.done_at ? { opacity: 0.55 } : undefined}>
                    <td style={t.done_at ? { textDecoration: "line-through" } : undefined}><b>{t.title}</b></td>
                    <td className={!t.done_at && t.due_on && t.due_on < today ? "wb-late" : undefined}>{t.due_on ?? "—"}</td>
                    <td>{t.return_id ? (() => { const r = returns.find((x) => x.id === t.return_id); return r ? returnLabel(r) : "—"; })() : "The client"}</td>
                    <td><form action={toggleTaskAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="back" value={back} /><input type="hidden" name="done" value={t.done_at ? "no" : "yes"} /><button className="monarch-link">{t.done_at ? "Reopen" : "Done"}</button></form></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
          <form action={addTaskAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
            <h2 className="is-wide">Add a task</h2>
            <input type="hidden" name="client_id" value={client.id} />
            <label>Task *<input name="title" required maxLength={200} /></label>
            <label>Due<input name="due_on" type="date" /></label>
            <label>For return<select name="return_id" defaultValue=""><option value="">The client in general</option>{returns.map((r) => <option key={r.id} value={r.id}>{returnLabel(r)}</option>)}</select></label>
            <div className="is-wide"><button className="monarch-primary">Add task</button></div>
          </form>
        </>
      )}

      {tab === "portal" && <PortalPanel area="admin" tenantId={client.tenant_id} clientId={client.id} email={client.email} signDocId={sp.sign} backHref={`/workspace/clients/${id}`} />}

      {tab === "notes" && (
        <>
          <form action={addNoteAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
            <input type="hidden" name="client_id" value={client.id} />
            <label className="is-wide">Add a note<textarea name="body" required rows={3} maxLength={4000} /></label>
            <div className="is-wide"><button className="monarch-primary">Save note</button></div>
          </form>
          <section className="monarch-panel">
            <div className="monarch-table-wrap"><table><tbody>
              {notes.length === 0 ? <EmptyRow colSpan={2}>No notes yet.</EmptyRow> : notes.map((n) => <tr key={n.id}><td style={{ whiteSpace: "nowrap", verticalAlign: "top" }}>{when(n.created_at)}</td><td style={{ whiteSpace: "pre-wrap" }}>{n.body}</td></tr>)}
            </tbody></table></div>
          </section>
        </>
      )}
    </>
  );
}
