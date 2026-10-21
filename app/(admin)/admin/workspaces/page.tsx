import { Badge, EmptyRow, Flash, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { HolderForm, HolderRowActions } from "@/components/office/holder-form";
import { practicePlatform } from "@/lib/practice/server";
import { requirePlatformAdmin } from "@/lib/admin";

/** Independent PTIN holders' workspaces: created and invited here by the platform administrator. */
export default async function PtinWorkspacesPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const result = await load(() => practicePlatform().listWorkspaces());
  return (
    <>
      <PageTitle title="PTIN workspaces">An independent PTIN holder gets their own workspace here, separate from every office. Create it and invite them; they set a password and turn on two-step sign-in. A preparer who works for an ERO is added in the office area instead.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <SetupRequired message={result.message} /> : (
        <div className="efin-flow">
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2 style={{ marginTop: 0 }}>Create a workspace</h2>
            <HolderForm />
          </section>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><div><h2>Workspaces</h2></div></div>
            <div className="monarch-table-wrap"><table>
              <thead><tr><th>WORKSPACE</th><th>PTIN HOLDER</th><th>STATUS</th><th></th></tr></thead>
              <tbody>
                {result.data.length === 0 ? <EmptyRow colSpan={4}>No workspaces yet.</EmptyRow> : result.data.map((w) => (
                  <tr key={w.id}>
                    <td><b>{w.name}</b></td>
                    <td>{w.member ? <>{w.member.full_name}<br /><span className="monarch-muted">{w.member.email}</span></> : <span className="monarch-muted">No owner yet</span>}</td>
                    <td>{w.member ? <><Badge value={w.member.status} />{w.member.last_seen_at ? <span className="monarch-muted"> · active {when(w.member.last_seen_at)}</span> : null}</> : null}</td>
                    <td>{w.member && <HolderRowActions tenantId={w.id} memberId={w.member.id} workspace={w.name} status={w.member.status} accepted={!!w.member.user_id} />}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
        </div>
      )}
    </>
  );
}
