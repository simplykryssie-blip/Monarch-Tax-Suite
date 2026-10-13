import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { formDeps } from "@/lib/forms/server";
import { Badge, EmptyRow, Flash, PageTitle, when } from "@/components/admin/ui";
import { formsLoad, FormsSetupRequired } from "@/components/forms/admin-bits";
import { createFormAction } from "./actions";

export default async function FormsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; archived?: string }> }) {
  await requireAdmin();
  const { notice, error, archived } = await searchParams;
  const result = await formsLoad(async () => {
    const deps = formDeps();
    const forms = (await deps.repo.listForms()).filter((f) => (archived ? f.status === "archived" : f.status !== "archived"));
    return Promise.all(forms.map(async (f) => {
      const { rows, total } = await deps.repo.listSubmissions(f.id, { status: "all", limit: 1 });
      return { f, total, last: rows[0]?.submitted_at ?? null };
    }));
  });
  return (
    <>
      <PageTitle title="Forms">Build forms by drag and drop, share a public link, and collect answers, files and signatures. Each submission is saved as a PDF on the customer.</PageTitle>
      <Flash notice={notice} error={error} />
      {!result.ok ? (
        <FormsSetupRequired message={result.message} />
      ) : (
        <>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2>New form</h2>
            <form action={createFormAction} className="monarch-inline-form" style={{ flexWrap: "wrap" }}>
              <input name="name" placeholder="Form name, for example ERO application" required minLength={2} maxLength={120} aria-label="Form name" />
              <button className="monarch-primary">Create form</button>
            </form>
          </section>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><h2>{archived ? "Archived forms" : "Your forms"}</h2><Link className="monarch-link" href={archived ? "/forms" : "/forms?archived=1"}>{archived ? "Show current forms" : "Show archived"}</Link></div>
            <div className="monarch-table-wrap">
              <table>
                <thead><tr><th>NAME</th><th>STATUS</th><th>SUBMISSIONS</th><th>LAST SUBMISSION</th><th>PUBLIC LINK</th><th>UPDATED</th></tr></thead>
                <tbody>
                  {result.data.length === 0 ? (
                    <EmptyRow colSpan={6}>{archived ? "No archived forms." : "No forms yet. Create your first one above."}</EmptyRow>
                  ) : (
                    result.data.map(({ f, total, last }) => (
                      <tr key={f.id}>
                        <td><Link href={`/forms/${f.id}`}><b>{f.name}</b></Link>{f.description && <small className="monarch-subcell">{f.description}</small>}</td>
                        <td><Badge value={f.status} /></td>
                        <td><Link href={`/forms/${f.id}/submissions`}>{total}</Link></td>
                        <td>{when(last)}</td>
                        <td>{f.current_version_id && f.status === "published" ? <code>/f/{f.public_id}</code> : "—"}</td>
                        <td>{when(f.updated_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
