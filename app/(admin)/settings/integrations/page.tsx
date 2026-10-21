import { requireSection } from "@/lib/tier-server";
import { Badge, EmptyRow, Flash, load, PageTitle, when } from "@/components/admin/ui";
import { revokeLinkAction } from "../../automation/actions";
import { automationDeps } from "@/lib/automation/server";

const currentTime = () => Date.now();

/** The setup links sent to calculator customers (Monarch's own product). Platform connection health lives under Admin → Integrations. */
export default async function SetupLinksPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireSection("bureau");
  const { notice, error } = await searchParams;
  const links = await load(() => automationDeps().repo.listLinks(20));
  const now = currentTime();
  return (
    <>
      <PageTitle title="Calculator setup links">The setup links sent to your calculator customers.</PageTitle>
      <Flash notice={notice} error={error} />
      <section className="monarch-panel"><div className="monarch-panel-head"><div><h2>Customer setup links</h2><p>Only a hash of each link is stored. Links expire after 14 days and can be revoked.</p></div></div>
        <div className="monarch-table-wrap"><table><thead><tr><th>LICENSE</th><th>CREATED</th><th>EXPIRES</th><th>OPENED</th><th>STATE</th><th></th></tr></thead><tbody>
          {!links.ok || links.data.length === 0 ? <EmptyRow colSpan={6}>No setup links yet.</EmptyRow> : links.data.map((l) => {
            const state = l.revoked_at ? "revoked" : Date.parse(l.expires_at) <= now ? "expired" : "active";
            return <tr key={l.id}><td><a href={`/licenses/${l.license_id}`}>License</a></td><td>{when(l.created_at)}</td><td>{when(l.expires_at)}</td><td>{when(l.first_opened_at)}</td><td><Badge value={state} /></td><td>{state === "active" && <form action={revokeLinkAction}><input type="hidden" name="id" value={l.id} /><button className="monarch-link">Revoke</button></form>}</td></tr>;
          })}
        </tbody></table></div></section>
    </>
  );
}
