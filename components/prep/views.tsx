import { FormattedInput } from "@/components/forms/formatted-input";
import { ImportPanel } from "@/components/imports/import-panel";
import { PortalPanel } from "@/components/portal/panel";
import Link from "next/link";
import { Badge, EmptyRow, Flash } from "@/components/admin/ui";
import {
  addClientAction, addItemAction, assignAction, handOffAction, removeItemAction, saveClientAction, saveNotesAction, setStatusAction, startReturnAction, toggleItemAction,
} from "@/app/prep-actions";
import type { PrepContext } from "@/lib/prep/server";
import { checklistFor, loadClient, loadReturn, visibleClients, visibleReturns } from "@/lib/prep/service.ts";
import { PREP_STATUSES, RETURN_KINDS, type PrepStatus } from "@/lib/workspace/types.ts";

// The screens for client intake, return preparation and assigned returns. The PTIN holder's workspace and the office
// area render the same ones; the context says whose work they show and where their links go.

type Search = { q?: string; notice?: string; error?: string };
const YEAR = new Date().getUTCFullYear();
const hidden = (ctx: PrepContext) => <input type="hidden" name="area" value={ctx.area} />;
const who = (ctx: PrepContext, id: string | null) => (id ? ctx.members.find((m) => m.id === id)?.name ?? "Someone else" : "Unassigned");

export async function ClientsView({ ctx, sp }: { ctx: PrepContext; sp: Search }) {
  const q = (sp.q ?? "").slice(0, 80);
  const [clients, returns] = await Promise.all([visibleClients(ctx.deps, ctx.scope, q), visibleReturns(ctx.deps, ctx.scope)]);
  return (
    <>
      <h1 className="office-h1">My Clients</h1>
      <Flash notice={sp.notice} error={sp.error} />
      <section className="monarch-panel">
        <div className="monarch-panel-head">
          <form method="get" className="monarch-inline-form"><input name="q" type="search" defaultValue={q} placeholder="Search name, email or phone" aria-label="Search clients" maxLength={80} /><button className="monarch-secondary">Search</button>{q && <Link href={`${ctx.base}/clients`}>Clear</Link>}</form>
        </div>
        <div className="monarch-table-wrap"><table>
          <thead><tr><th>CLIENT</th><th>CONTACT</th><th>TAGS</th><th>RETURNS</th></tr></thead>
          <tbody>
            {clients.length === 0 ? <EmptyRow colSpan={4}>{q ? "No clients match that search." : "No clients yet. Add your first one below."}</EmptyRow> : clients.map((c) => {
              const years = [...new Set(returns.filter((r) => r.client_id === c.id).map((r) => r.tax_year))].sort().reverse();
              return (
                <tr key={c.id}>
                  <td><Link href={`${ctx.base}/clients/${c.id}`}><b>{c.full_name}</b></Link></td>
                  <td>{c.email ?? "—"}{c.phone && <small className="monarch-subcell">{c.phone}</small>}</td>
                  <td>{c.tags?.length ? c.tags.join(", ") : "—"}</td>
                  <td>{years.length ? years.join(", ") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </section>
      <ImportPanel scope={ctx.area} destinations={["clients"]} />
      <section className="monarch-panel" id="add" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Add a client</h2>
        <form action={addClientAction} className="monarch-form">
          {hidden(ctx)}
          <label>Name *<input name="full_name" required maxLength={200} autoComplete="off" /></label>
          <label>Email<input name="email" type="email" maxLength={254} autoComplete="off" /></label>
          <label>Phone<FormattedInput kind="phone" name="phone" autoComplete="off" /></label>
          <label>Social Security number or ITIN<FormattedInput kind="ssn" name="ssn" secret autoComplete="off" placeholder="Nine digits" /></label>
          <label className="is-wide">Address<input name="address" maxLength={300} autoComplete="off" /></label>
          <div className="is-wide"><button className="monarch-primary">Add client</button></div>
        </form>
      </section>
    </>
  );
}

export async function ClientView({ ctx, id, sp }: { ctx: PrepContext; id: string; sp: Search }) {
  const client = await loadClient(ctx.deps, ctx.scope, id);
  const returns = (await visibleReturns(ctx.deps, ctx.scope, { clientId: client.id })).sort((a, b) => b.tax_year - a.tax_year);
  // Notes and the message history (including what was imported). The client was already checked as one this person may see.
  const [notes, messages] = await Promise.all([ctx.deps.ws.listNotes(client.id).catch(() => []), ctx.deps.ws.listMessages(client.id).catch(() => [])]);
  const when = (iso: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" }).format(new Date(iso));
  const CHANNEL = { email: "Email", sms: "Text", call: "Call", other: "Other", portal: "Portal" } as const;
  return (
    <>
      <Link className="monarch-back" href={`${ctx.base}/clients`}>← My Clients</Link>
      <h1 className="office-h1">{client.full_name}</h1>
      {client.tags?.length ? <p aria-label="Tags">{client.tags.map((t) => <span key={t} className="monarch-badge" style={{ marginRight: 6 }}>{t}</span>)}</p> : null}
      <Flash notice={sp.notice} error={sp.error} />
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Details</h2>
        <form action={saveClientAction} className="monarch-form">
          {hidden(ctx)}
          <input type="hidden" name="id" value={client.id} />
          <label>Name *<input name="full_name" required maxLength={200} defaultValue={client.full_name} autoComplete="off" /></label>
          <label>Email<input name="email" type="email" maxLength={254} defaultValue={client.email ?? ""} autoComplete="off" /></label>
          <label>Phone<FormattedInput kind="phone" name="phone" defaultValue={client.phone ?? ""} autoComplete="off" /></label>
          <input type="hidden" name="ssn_last4" value={client.ssn_last4 ?? ""} />
          <label>Social Security number or ITIN<FormattedInput kind="ssn" name="ssn" secret autoComplete="off" placeholder={client.ssn_last4 ? `Ends in ${client.ssn_last4}. Type a full number to replace it` : "Nine digits"} /></label>
          <label className="is-wide">Address<input name="address" maxLength={300} defaultValue={client.address ?? ""} autoComplete="off" /></label>
          <div className="is-wide"><button className="monarch-primary">Save</button></div>
        </form>
      </section>
      <PortalPanel area={ctx.area === "practice" ? "practice" : "office"} tenantId={ctx.tenantId} clientId={client.id} email={client.email} />
      <section className="monarch-panel" id="notes" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Notes</h2>
        {notes.length === 0 ? <p className="monarch-muted">No notes yet. Notes you import appear here.</p> : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>{notes.map((n) => <li key={n.id}><small className="monarch-muted">{when(n.created_at)}</small><div style={{ whiteSpace: "pre-wrap" }}>{n.body}</div></li>)}</ul>
        )}
      </section>
      <section className="monarch-panel" id="messages" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Messages</h2>
        {messages.length === 0 ? <p className="monarch-muted">No messages yet. Messages you import appear here as history only.</p> : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>{messages.map((m) => (
            <li key={m.id}>
              <small className="monarch-muted">{when(m.occurred_at)} · {m.direction === "in" ? "From the client" : "To the client"} · {CHANNEL[m.channel]}{m.status === "logged" ? " · logged" : ""}</small>
              {m.subject && <div><b>{m.subject}</b></div>}
              <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
            </li>
          ))}</ul>
        )}
      </section>
      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>Returns</h2></div></div>
        <div className="monarch-table-wrap"><table>
          <thead><tr><th>YEAR</th><th>TYPE</th><th>STATUS</th><th>PREPARER</th><th></th></tr></thead>
          <tbody>
            {returns.length === 0 ? <EmptyRow colSpan={5}>No returns yet. Start one below.</EmptyRow> : returns.map((r) => (
              <tr key={r.id}>
                <td><b>{r.tax_year}</b></td><td>{RETURN_KINDS[r.kind]}</td><td><Badge value={r.prep_status} /></td><td>{who(ctx, r.assignee_id)}</td>
                <td><Link className="monarch-secondary efin-small" href={`${ctx.base}/prep/${r.id}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Start a return</h2>
        <form action={startReturnAction} className="monarch-form">
          {hidden(ctx)}
          <input type="hidden" name="client_id" value={client.id} />
          <label>Tax year<input name="tax_year" type="number" inputMode="numeric" min={2000} max={YEAR + 1} defaultValue={YEAR - 1} required /></label>
          <label>Type<select name="kind" defaultValue="original">{Object.entries(RETURN_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <div className="is-wide"><button className="monarch-primary">Start return</button></div>
        </form>
      </section>
    </>
  );
}

const COLUMNS: PrepStatus[] = ["not_started", "in_prep", "ready_for_review", "handed_off"];

export async function PrepBoardView({ ctx, sp }: { ctx: PrepContext; sp: Search }) {
  const [returns, clients] = await Promise.all([visibleReturns(ctx.deps, ctx.scope), visibleClients(ctx.deps, ctx.scope)]);
  const name = new Map(clients.map((c) => [c.id, c.full_name]));
  const cols = COLUMNS.filter((s) => s !== "handed_off" || ctx.canHandOff);
  return (
    <>
      <h1 className="office-h1">Prep work</h1>
      <Flash notice={sp.notice} error={sp.error} />
      {returns.length === 0 && <section className="monarch-panel" style={{ padding: 20 }}><p>No returns yet. Open a client and start a return.</p><Link className="monarch-primary" href={`${ctx.base}/clients`}>Go to My Clients</Link></section>}
      <div className="prep-board">
        {cols.map((s) => {
          const rows = returns.filter((r) => r.prep_status === s).sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999"));
          return (
            <section key={s} className="monarch-panel prep-col">
              <div className="monarch-panel-head"><div><h2>{PREP_STATUSES[s]} <small>({rows.length})</small></h2></div></div>
              <ul className="prep-cards">
                {rows.map((r) => (
                  <li key={r.id}><Link href={`${ctx.base}/prep/${r.id}`}><b>{name.get(r.client_id) ?? "Client"}</b><span>{r.tax_year} · {RETURN_KINDS[r.kind]}{r.due_on ? ` · due ${r.due_on}` : ""}</span></Link></li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

export async function AssignedView({ ctx, sp }: { ctx: PrepContext; sp: Search }) {
  const [returns, clients] = await Promise.all([visibleReturns(ctx.deps, ctx.scope, { assignedOnly: true }), visibleClients(ctx.deps, ctx.scope)]);
  const name = new Map(clients.map((c) => [c.id, c.full_name]));
  return (
    <>
      <h1 className="office-h1">Assigned returns</h1>
      <p className="monarch-muted">The returns assigned to you. This list is for viewing; open a return from Prep work to change it.</p>
      <Flash notice={sp.notice} error={sp.error} />
      <section className="monarch-panel">
        <div className="monarch-table-wrap"><table>
          <thead><tr><th>CLIENT</th><th>YEAR</th><th>TYPE</th><th>STATUS</th><th>DUE</th></tr></thead>
          <tbody>
            {returns.length === 0 ? <EmptyRow colSpan={5}>Nothing is assigned to you right now.</EmptyRow> : returns.map((r) => (
              <tr key={r.id}><td><b>{name.get(r.client_id) ?? "Client"}</b></td><td>{r.tax_year}</td><td>{RETURN_KINDS[r.kind]}</td><td><Badge value={r.prep_status} /></td><td>{r.due_on ?? "—"}</td></tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </>
  );
}

export async function ReturnView({ ctx, id, sp }: { ctx: PrepContext; id: string; sp: Search }) {
  const { ret, client } = await loadReturn(ctx.deps, ctx.scope, id);
  const [items, docs, handoffs] = await Promise.all([checklistFor(ctx.deps, ctx.scope, ret.id), ctx.deps.ws.listDocs(client.id), ctx.deps.prep.listHandoffs(ret.id)]);
  const locked = ret.prep_status === "handed_off";
  const mayAssign = ctx.members.length > 1 && (ctx.scope.all || client.owner_id === ctx.userId) && !locked;
  const open = items.filter((i) => !i.done_at).length;
  return (
    <>
      <Link className="monarch-back" href={`${ctx.base}/prep`}>← Prep work</Link>
      <h1 className="office-h1">{client.full_name} · {ret.tax_year} {RETURN_KINDS[ret.kind].toLowerCase()}</h1>
      <Flash notice={sp.notice} error={sp.error} />
      <section className="monarch-panel" style={{ padding: 20 }}>
        <div className="prep-status"><span>Status</span> <Badge value={ret.prep_status} /> <span className="monarch-muted">Preparer: {who(ctx, ret.assignee_id)}{ret.due_on ? ` · due ${ret.due_on}` : ""}</span></div>
        {locked ? <p className="monarch-muted">This return was handed to an ERO{ret.handed_off_at ? ` on ${ret.handed_off_at.slice(0, 10)}` : ""} and is locked here.</p> : (
          <div className="prep-actions">
            {ret.prep_status === "not_started" && <StatusButton ctx={ctx} id={ret.id} to="in_prep" label="Start prep" primary />}
            {ret.prep_status === "in_prep" && <StatusButton ctx={ctx} id={ret.id} to="ready_for_review" label="Mark ready for review" primary />}
            {ret.prep_status === "ready_for_review" && <StatusButton ctx={ctx} id={ret.id} to="in_prep" label="Back to prep" />}
            {ret.prep_status === "in_prep" && open > 0 && <small className="monarch-muted">{open} checklist item{open === 1 ? "" : "s"} still open.</small>}
          </div>
        )}
        {mayAssign && (
          <form action={assignAction} className="monarch-inline-form" style={{ marginTop: 12 }}>
            {hidden(ctx)}<input type="hidden" name="id" value={ret.id} />
            <select name="assignee" defaultValue={ret.assignee_id ?? ""} aria-label="Assign to">{ctx.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            <button className="monarch-secondary">Assign</button>
          </form>
        )}
      </section>
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Intake checklist</h2>
        <ul className="prep-checklist">
          {items.map((i) => (
            <li key={i.id}>
              <form action={toggleItemAction}>
                {hidden(ctx)}<input type="hidden" name="id" value={ret.id} /><input type="hidden" name="item" value={i.id} /><input type="hidden" name="done" value={i.done_at ? "no" : "yes"} />
                <button className="prep-check" disabled={locked} aria-pressed={!!i.done_at}><span aria-hidden>{i.done_at ? "☑" : "☐"}</span> <span className={i.done_at ? "is-done" : ""}>{i.label}</span></button>
              </form>
              {!locked && <form action={removeItemAction}>{hidden(ctx)}<input type="hidden" name="id" value={ret.id} /><input type="hidden" name="item" value={i.id} /><button className="monarch-link" aria-label={`Remove ${i.label}`}>Remove</button></form>}
            </li>
          ))}
        </ul>
        {!locked && (
          <form action={addItemAction} className="monarch-inline-form">
            {hidden(ctx)}<input type="hidden" name="id" value={ret.id} />
            <input name="label" placeholder="Add an item" aria-label="New checklist item" maxLength={200} required /><button className="monarch-secondary">Add</button>
          </form>
        )}
      </section>
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Prep notes</h2>
        <form action={saveNotesAction} className="monarch-form">
          {hidden(ctx)}<input type="hidden" name="id" value={ret.id} />
          <label className="is-wide">Notes for this return<textarea name="notes" rows={5} maxLength={2000} defaultValue={ret.notes ?? ""} disabled={locked} /></label>
          {!locked && <div className="is-wide"><button className="monarch-primary">Save notes</button></div>}
        </form>
      </section>
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Documents on file</h2>
        {docs.length === 0 ? <p className="monarch-muted">No documents on this client yet.</p> : <ul>{docs.map((d) => <li key={d.id}>{d.title} <span className="monarch-muted">({d.file_type})</span></li>)}</ul>}
      </section>
      {ctx.canHandOff && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Hand to an ERO</h2>
          <p className="monarch-muted">Sends the ERO a file with this return&apos;s details, prep notes, checklist and document list. Nothing is shared between accounts: the ERO imports the file. The return is locked here afterwards.</p>
          {ret.prep_status === "ready_for_review" ? (
            <form action={handOffAction} className="monarch-inline-form">
              {hidden(ctx)}<input type="hidden" name="id" value={ret.id} />
              <input name="to" type="email" placeholder="ERO's email" aria-label="ERO's email" required maxLength={254} /><button className="monarch-primary">Send to ERO</button>
            </form>
          ) : !locked && <p className="monarch-muted">Mark the return ready for review first.</p>}
          {handoffs.length > 0 && (
            <ul className="prep-handoffs">{handoffs.map((h) => <li key={h.id}>{h.created_at.slice(0, 10)} · {h.to_email} · <Badge value={h.status} />{h.error ? ` · ${h.error}` : ""}</li>)}</ul>
          )}
        </section>
      )}
    </>
  );
}

function StatusButton({ ctx, id, to, label, primary }: { ctx: PrepContext; id: string; to: PrepStatus; label: string; primary?: boolean }) {
  return (
    <form action={setStatusAction}>
      {hidden(ctx)}<input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={to} />
      <button className={primary ? "monarch-primary" : "monarch-secondary"}>{label}</button>
    </form>
  );
}
