import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { automationDeps } from "@/lib/automation/server";
import { EmptyRow, Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { Modal } from "@/components/ui/modal";
import { SubmitOnce } from "@/components/admin/submit-once";
import { leadsDeps } from "@/lib/leads/server";
import { allTags } from "@/lib/tags/service.ts";
import { workflowsUsingTag } from "@/lib/tags/rules.ts";
import { workspaceRepo } from "@/lib/workspace/server";
import { deleteTagAction, renameTagAction } from "./actions";

/** Every tag in use, with who has it. Rename, merge or delete one for everybody at once. */
export default async function TagsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const result = await load(async () => {
    const [tags, workflows] = await Promise.all([allTags({ clients: workspaceRepo(), leads: leadsDeps().repo }), automationDeps().repo.listWorkflows().catch(() => [])]);
    return { tags, workflows };
  });
  return (
    <>
      <PageTitle title="Tags">Every tag you use on clients and leads. Change one here and it changes for everyone who has it.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      {!result.ok ? <SetupRequired message={result.message} /> : (
        <section className="monarch-panel">
          <div className="monarch-table-wrap">
            <table>
              <thead><tr><th>TAG</th><th>CLIENTS</th><th>LEADS</th><th /></tr></thead>
              <tbody>
                {result.data.tags.length === 0 ? <EmptyRow colSpan={4}>No tags yet. Add tags on a client or lead and they will be listed here.</EmptyRow> : result.data.tags.map(({ tag, clients, leads }) => {
                  const used = workflowsUsingTag(tag, result.data.workflows).map((w) => w.name);
                  const warn = used.length > 0 && (
                    <div className="is-wide monarch-notice" role="status">
                      <b>{used.length === 1 ? "A workflow uses" : `${used.length} workflows use`} this tag:</b> {used.join(", ")}. They keep the old name until you edit them.
                    </div>
                  );
                  return (
                    <tr key={tag}>
                      <td><Link href={`/contacts?tag=${encodeURIComponent(tag)}`}><b>{tag}</b></Link>{used.length > 0 && <small className="monarch-subcell">used in {used.length} {used.length === 1 ? "workflow" : "workflows"}</small>}</td>
                      <td>{clients}</td>
                      <td>{leads}</td>
                      <td className="cl-card-actions">
                        <Link className="monarch-link" href={`/contacts?tag=${encodeURIComponent(tag)}`}>View</Link>
                        <Modal label="Rename" title={`Rename “${tag}”`} className="monarch-link">
                          <form action={renameTagAction} className="monarch-form">
                            <input type="hidden" name="tag" value={tag} />
                            <label className="is-wide">New name<input name="to" required maxLength={40} defaultValue={tag} /></label>
                            <p className="is-wide monarch-muted">If a tag with that name already exists, the two become one.</p>
                            {warn}
                            <div className="is-wide"><SubmitOnce className="monarch-primary" busy="Renaming…">Rename for everyone</SubmitOnce></div>
                          </form>
                        </Modal>
                        <Modal label="Delete" title={`Delete “${tag}”`} className="monarch-link is-danger">
                          <form action={deleteTagAction} className="monarch-form">
                            <input type="hidden" name="tag" value={tag} />
                            <p className="is-wide">This takes “{tag}” off {clients + leads === 1 ? "1 person" : `${clients + leads} people`}. The people stay; only the tag goes.</p>
                            {warn}
                            <div className="is-wide"><SubmitOnce className="monarch-primary is-danger" busy="Deleting…">Delete tag</SubmitOnce></div>
                          </form>
                        </Modal>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
