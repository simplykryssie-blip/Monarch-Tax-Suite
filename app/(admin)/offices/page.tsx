import { requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, Flash, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { InviteForm } from "@/components/office/invite-form";
import { officeDeps } from "@/lib/office/server";
import { ROLE_LABEL } from "@/lib/office/permissions.ts";
import { currentTenantId } from "@/lib/tenants";
import { chooseOfficeAction } from "@/app/office/actions";

/** Who can sign in to each office, and invites for EROs. Open any office's area to see what its team sees. */
export default async function OfficeAccessPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const deps = officeDeps(currentTenantId());
  const result = await load(async () => ({ offices: (await deps.repo.listOffices()).filter((o) => !o.archived), members: await deps.repo.listMembers() }));
  return (
    <>
      <PageTitle title="Office access">Each firm in My Service Bureau is an office. Invite its ERO here; the ERO then invites their preparers and chooses what each one can reach. Everyone signs in at the same address, and two-step sign-in is recommended but their choice.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <SetupRequired message={result.message} /> : (
        <div className="efin-flow">
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2 style={{ marginTop: 0 }}>Invite an ERO</h2>
            <InviteForm mode="bureau" offices={result.data.offices} />
          </section>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Offices</h2><p>Open an office to see it as its team does and manage its people. You&apos;ll be asked for your own two-step code.</p></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>OFFICE</th><th>PEOPLE</th><th></th></tr></thead>
              <tbody>
                {result.data.offices.length === 0 ? <EmptyRow colSpan={3}>No firms yet. Add one in My Service Bureau.</EmptyRow> : result.data.offices.map((o) => {
                  const people = result.data.members.filter((m) => m.organization_id === o.id);
                  return (
                    <tr key={o.id}>
                      <td><b>{o.name}</b></td>
                      <td>
                        {people.length === 0 ? <span className="monarch-muted">No one invited yet</span> : (
                          <ul className="office-people">{people.map((m) => <li key={m.id}>{m.full_name} · {ROLE_LABEL[m.role]} · <Badge value={m.status} />{m.last_seen_at ? <span className="monarch-muted"> · active {when(m.last_seen_at)}</span> : null}</li>)}</ul>
                        )}
                      </td>
                      <td><form action={chooseOfficeAction}><input type="hidden" name="office_id" value={o.id} /><button className="monarch-secondary efin-small">Open office area</button></form></td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </section>
        </div>
      )}
    </>
  );
}
