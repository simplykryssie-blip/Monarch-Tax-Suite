import { FormattedInput } from "@/components/forms/formatted-input";
import { PortalPanel } from "@/components/portal/panel";
import { requireAdmin } from "@/lib/admin";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, EmptyRow, Flash, PageTitle, when } from "@/components/admin/ui";
import { ClientDocUpload } from "@/components/workspace/client-doc-upload";
import { SubmitOnce } from "@/components/admin/submit-once";
import { RevealSsn } from "@/components/workspace/reveal-ssn";
import { hasStoredSsn, numberActivity } from "@/lib/ssn/service.ts";
import { ssnDeps } from "@/lib/ssn/server";
import { balance, defaultInvoiceLines, dollars, invoiceView } from "@/lib/workspace/rules.ts";
import { RETURN_KINDS } from "@/lib/workspace/types.ts";
import { boardStages, todayIso, workspaceLoad, workspaceRepo } from "@/lib/workspace/load";
import { addNoteAction, addReturnAction, addTaskAction, archiveClientAction, createInvoiceAction, deleteClientDocAction, invoiceStatusAction, logMessageAction, openClientDocAction, saveClientAction, sendMessageAction, toggleTaskAction } from "../../actions";
import { SMS_MAX } from "@/lib/automation/sms.ts";
import { toE164 } from "@/lib/automation/twilio.ts";
import { tenantSms } from "@/lib/sms/server";
import { emailConfig, emailKeyProblems } from "@/lib/automation/email.ts";
import { WorkspaceSetup } from "../../setup";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABS = [["overview", "Overview"], ["documents", "Documents"], ["messages", "Messages"], ["work", "Work"], ["billing", "Billing"], ["tasks", "Tasks"], ["notes", "Notes"], ["portal", "Portal"]] as const;
const CHANNELS = { email: "Email", sms: "Text", call: "Call", other: "Other" } as const;

/** One client: overview, documents, messages, work, billing (with the $223 breakdown), tasks and notes. */
export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; sign?: string; notice?: string; error?: string }> }) {
  const { id } = await params;
  const me = (await requireAdmin()).userId;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "overview";
  const today = todayIso();
  const result = await workspaceLoad(async () => {
    const repo = workspaceRepo();
    const client = await repo.getClient(id);
    if (!client) return null;
    const [returns, docs, messages, tasks, notes, invoices, stages] = await Promise.all([repo.listReturns({ clientId: id }), repo.listDocs(id), repo.listMessages(id), repo.listTasks({ clientId: id }), repo.listNotes(id), repo.listInvoices({ clientId: id }), boardStages()]);
    return { client, returns, docs, messages, tasks, notes, invoices, stages };
  });
  if (result.ok && !result.data) notFound();
  if (!result.ok) return <><PageTitle title="Client" back={{ href: "/workspace/clients", label: "Clients" }} /><WorkspaceSetup message={result.message} /></>;
  const { client, returns, docs, messages, tasks, notes, invoices, stages } = result.data!;
  // The office's own texting account, and its prepaid credits when it has them (tenant #1 pays Twilio directly).
  const sms = tab === "messages" ? await tenantSms().catch(() => null) : null;
  const credits = sms?.route.billing === "credits" ? await sms.repo.balance().catch(() => null) : null;
  const ssnOnFile = await hasStoredSsn(ssnDeps(), client.id).catch(() => false);
  const activity = await numberActivity(ssnDeps(), client.id).catch(() => []);
  const stageName = (sid: string) => stages.find((s) => s.id === sid)?.name ?? "Intake";
  const returnLabel = (r: { kind: keyof typeof RETURN_KINDS; tax_year: number }) => `${RETURN_KINDS[r.kind]} ${r.tax_year}`;
  const owes = invoices.filter((i) => i.status === "sent").reduce((n, i) => n + balance(i), 0);
  const back = `/workspace/clients/${id}?tab=${tab}`;
  return (
    <>
      <PageTitle title={client.full_name} back={{ href: "/workspace/clients", label: "Clients" }}>
        {[client.email, client.phone].filter(Boolean).join(" · ") || "No contact details yet"}{client.archived_at ? " · Archived" : ""}
      </PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      <nav className="cl-tabs" aria-label="Client">
        {TABS.map(([k, label]) => <Link key={k} href={`/workspace/clients/${id}?tab=${k}`} className={k === tab ? "is-on" : undefined} aria-current={k === tab ? "page" : undefined}>{label}</Link>)}
      </nav>

      {tab === "overview" && (
        <div className="grid2">
          <form action={saveClientAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
            <h2 className="is-wide">Details</h2>
            <input type="hidden" name="id" value={client.id} />
            <label>Name *<input name="full_name" required maxLength={200} defaultValue={client.full_name} /></label>
            <label>Email<input name="email" type="email" maxLength={254} defaultValue={client.email ?? ""} /></label>
            <label>Phone<FormattedInput kind="phone" name="phone" defaultValue={client.phone ?? ""} /></label>
            <input type="hidden" name="ssn_last4" value={client.ssn_last4 ?? ""} />
            <div className="is-wide"><span>Social Security number or ITIN</span><RevealSsn clientId={client.id} last4={client.ssn_last4} onFile={ssnOnFile} /></div>
            {activity.length > 0 && (
              <details className="is-wide cl-ssn-log"><summary>Number activity ({activity.length})</summary>
                <ul>{activity.map((a, i) => <li key={i}>{a.label} · {a.actorId === me ? "you" : a.actorId ? "a teammate" : "the system"} · {when(a.at)}</li>)}</ul>
              </details>
            )}
            <label className="is-wide">Address<input name="address" maxLength={300} defaultValue={client.address ?? ""} /></label>
            <div className="is-wide"><button className="monarch-primary">Save</button></div>
          </form>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2>At a glance</h2>
            <ul style={{ lineHeight: 1.9 }}>
              <li><b>{returns.length}</b> return{returns.length === 1 ? "" : "s"}{returns.length ? ` · latest ${returnLabel(returns[returns.length - 1])}, ${stageName(returns[returns.length - 1].stage_id)}` : ""}</li>
              <li><b>{owes ? dollars(owes) : "Nothing"}</b> owed</li>
              <li><b>{tasks.filter((t) => !t.done_at).length}</b> open task{tasks.filter((t) => !t.done_at).length === 1 ? "" : "s"}</li>
              <li><b>{docs.length}</b> document{docs.length === 1 ? "" : "s"}</li>
            </ul>
            <form action={archiveClientAction} className="monarch-inline-form" style={{ flexWrap: "wrap", marginTop: 16 }}>
              <input type="hidden" name="id" value={client.id} />
              {client.archived_at && <input type="hidden" name="restore" value="yes" />}
              <label><input type="checkbox" name="confirm" value="yes" required /> {client.archived_at ? "Restore this client" : "Archive this client (their returns, invoices and documents are kept)"}</label>
              <button className="monarch-secondary">{client.archived_at ? "Restore" : "Archive"}</button>
            </form>
          </section>
        </div>
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
            {client.archived_at ? <p className="monarch-muted">This client is archived. Restore them on the Overview tab to send messages.</p> : (
              <div className="grid2">
                <form action={sendMessageAction} className="monarch-form">
                  <h3 className="is-wide">Email {client.email ? <small className="monarch-muted">to {client.email}</small> : null}</h3>
                  <input type="hidden" name="client_id" value={client.id} /><input type="hidden" name="channel" value="email" />
                  {!client.email ? <p className="is-wide monarch-muted">Add an email address on the Overview tab to email this client.</p> : emailProblem ? <p className="is-wide monarch-muted">Email sending isn&apos;t set up yet: {emailProblem}</p> : (
                    <>
                      <label className="is-wide">Subject *<input name="subject" required maxLength={200} /></label>
                      <label className="is-wide">Message *<textarea name="body" required rows={6} maxLength={4000} /></label>
                      <div className="is-wide"><SubmitOnce className="monarch-primary" busy="Sending…">Send email</SubmitOnce></div>
                    </>
                  )}
                </form>
                <form action={sendMessageAction} className="monarch-form">
                  <h3 className="is-wide">Text {mobile ? <small className="monarch-muted">to {mobile}</small> : null}</h3>
                  <input type="hidden" name="client_id" value={client.id} /><input type="hidden" name="channel" value="sms" />
                  {!mobile ? <p className="is-wide monarch-muted">Add a mobile number on the Overview tab to text this client.</p> : smsProblem ? <p className="is-wide monarch-muted">Text messaging isn&apos;t connected yet: {smsProblem}</p> : (
                    <>
                      <label className="is-wide">Message *<textarea name="body" required rows={4} maxLength={SMS_MAX} /><small className="monarch-muted">Up to {SMS_MAX} characters (longer than 160 characters counts as more than one segment).{credits !== null ? ` Each segment uses one text credit; this office has ${credits}.` : ""} Only text clients who agreed to receive texts.</small></label>
                      <div className="is-wide"><SubmitOnce className="monarch-primary" busy="Sending…">Send text</SubmitOnce></div>
                    </>
                  )}
                </form>
              </div>
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

      {tab === "work" && (
        <>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Work</h2><p>Each return, extension and amendment is its own card on the My Work board.</p></div><Link className="mt-card-link" href="/workspace/work">Open the board</Link></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>RETURN</th><th>STAGE</th><th>DUE</th><th>FILED</th></tr></thead>
              <tbody>
                {returns.length === 0 ? <EmptyRow colSpan={4}>No returns yet.</EmptyRow> : returns.map((r) => (
                  <tr key={r.id} id={`return-${r.id}`}><td><b>{returnLabel(r)}</b></td><td>{stageName(r.stage_id)}</td><td className={r.due_on && r.due_on < today && r.stage_id !== stages[stages.length - 1].id ? "wb-late" : undefined}>{r.due_on ?? "—"}</td><td>{r.filed_on ?? "—"}</td></tr>
                ))}
              </tbody>
            </table></div>
          </section>
          <form action={addReturnAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
            <h2 className="is-wide">Add a return</h2>
            <input type="hidden" name="client_id" value={client.id} /><input type="hidden" name="back" value={back} />
            <label>Tax year *<input name="tax_year" required inputMode="numeric" maxLength={4} defaultValue={new Date().getUTCFullYear() - 1} /></label>
            <label>Kind<select name="kind" defaultValue="original">{Object.entries(RETURN_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Due date<input name="due_on" type="date" /><small className="monarch-muted">Leave blank for April 15 (October 15 for an extension).</small></label>
            <div className="is-wide"><button className="monarch-primary">Add return</button></div>
          </form>
        </>
      )}

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
