import { redirect } from "next/navigation";
import { requireOffice, officeDeps } from "@/lib/office/server";
import { can, DELEGABLE, ROLE_LABEL } from "@/lib/office/permissions.ts";
import { Badge, EmptyRow, Flash, when } from "@/components/admin/ui";
import { ActionForm } from "@/app/(admin)/efin/action-form";
import { InviteForm } from "@/components/office/invite-form";
import { cancelInviteAction, setPermissionsAction, suspendAction } from "../../actions";

/** The ERO's team: invite preparers, choose what each one can reach, suspend or reactivate. */
export default async function OfficeTeam({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const ctx = await requireOffice();
  if (!can(ctx.role, ctx.permissions, "team.manage")) redirect("/office");
  const sp = await searchParams;
  const deps = officeDeps(ctx.tenantId);
  const [members, events] = await Promise.all([deps.repo.listMembers(ctx.office.id), deps.repo.listEvents(ctx.office.id, 30)]);
  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.full_name ?? "";
  return (
    <>
      <h1 className="office-h1">Team &amp; permissions</h1>
      <Flash notice={sp.notice} error={sp.error} />
      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>Team</h2><p>Every account signs in with a password and two-step sign-in. An ERO has every ERO feature; for each preparer, you choose.</p></div></div>
        <div className="monarch-table-wrap"><table>
          <thead><tr><th>NAME</th><th>ROLE</th><th>STATUS</th><th>LAST ACTIVE</th><th>CAN REACH</th><th></th></tr></thead>
          <tbody>
            {members.length === 0 ? <EmptyRow colSpan={6}>No one yet. Invite your first preparer below.</EmptyRow> : members.map((m) => (
              <tr key={m.id}>
                <td><b>{m.full_name}</b><div className="monarch-muted">{m.email}</div></td>
                <td>{ROLE_LABEL[m.role]}</td>
                <td><Badge value={m.status} /></td>
                <td>{m.last_seen_at ? when(m.last_seen_at) : "—"}</td>
                <td>
                  {m.role === "preparer" ? (
                    <ActionForm action={setPermissionsAction} className="office-perms">
                      <input type="hidden" name="id" value={m.id} />
                      {DELEGABLE.map((f) => (
                        <label key={f.key} className="monarch-check">
                          <input type="hidden" name="known" value={f.key} />
                          <input type="checkbox" name="feature" value={f.key} defaultChecked={f.level === "preparer" ? m.permissions[f.key] !== false : m.permissions[f.key] === true} />
                          {f.label}{f.status === "soon" ? " (soon)" : ""}{f.level === "ero" ? " · ERO feature" : ""}
                        </label>
                      ))}
                      <button className="monarch-secondary efin-small">Save</button>
                    </ActionForm>
                  ) : <span className="monarch-muted">Every ERO feature</span>}
                </td>
                <td>
                  {m.id !== ctx.member?.id && (ctx.bureau || m.role === "preparer") && (
                    m.status === "suspended" && !m.user_id ? (
                      <span className="monarch-muted">Invite withdrawn. Invite them again below.</span>
                    ) : m.status === "invited" ? (
                      <ActionForm action={cancelInviteAction} confirm={`Withdraw the invite to ${m.email}?`}><input type="hidden" name="id" value={m.id} /><button className="monarch-secondary efin-small">Withdraw invite</button></ActionForm>
                    ) : (
                      <ActionForm action={suspendAction} confirm={m.status === "suspended" ? undefined : `Suspend ${m.full_name}? They won't be able to sign in to the office.`}>
                        <input type="hidden" name="id" value={m.id} /><input type="hidden" name="suspend" value={m.status === "suspended" ? "no" : "yes"} />
                        <button className={`monarch-secondary efin-small${m.status === "suspended" ? "" : " is-danger"}`}>{m.status === "suspended" ? "Reactivate" : "Suspend"}</button>
                      </ActionForm>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>{ctx.bureau ? "Invite someone to this office" : "Invite a preparer"}</h2>
        {ctx.bureau ? <InviteForm mode="bureau" offices={[ctx.office]} defaultOffice={ctx.office.id} /> : <InviteForm mode="ero" />}
      </section>
      <section className="monarch-panel">
        <div className="monarch-panel-head"><div><h2>Recent activity</h2></div></div>
        <ul className="fees-history">{events.length === 0 ? <li className="monarch-muted">Nothing yet.</li> : events.map((e) => <li key={e.id}><b>{e.action.replace(/_/g, " ")}</b>{e.member_id ? ` · ${nameOf(e.member_id)}` : ""} · {when(e.created_at)}</li>)}</ul>
      </section>
    </>
  );
}
