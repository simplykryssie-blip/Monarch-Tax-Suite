import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { formDeps } from "@/lib/forms/server";
import { readSettings } from "@/lib/forms/settings.ts";
import { effectiveBrand } from "@/lib/brands.ts";
import { Badge, EmptyRow, Flash, PageTitle, when } from "@/components/admin/ui";
import { formsLoad, FormsSetupRequired } from "@/components/forms/admin-bits";
import { createFormAction } from "./actions";
import { ArchiveRowButton, ArchiveTabs } from "@/components/admin/archive";
import { inView, viewCounts, viewOf } from "@/lib/archive.ts";

export default async function FormsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; view?: string; archived?: string }> }) {
  await requireAdmin();
  const { notice, error, view: rawView, archived: legacy } = await searchParams;
  const view = viewOf(legacy ? "archived" : rawView);
  const archived = view === "archived";
  const result = await formsLoad(async () => {
    const deps = formDeps();
    const all = await deps.repo.listForms();
    const forms = inView(all, view);
    const brands = deps.brandCatalog ? await deps.brandCatalog().then((c) => c.brands).catch(() => []) : [];
    const rows = await Promise.all(forms.map(async (f) => {
      const { rows, total } = await deps.repo.listSubmissions(f.id, { status: "all", limit: 1 });
      return { f, total, last: rows[0]?.submitted_at ?? null, brand: effectiveBrand(readSettings(f.settings).brand_domain_id, brands)?.name ?? null };
    }));
    return { rows, brands, counts: viewCounts(all) };
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
              <span style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", flex: "1 1 100%" }}>
                <input name="name" placeholder="Form name, for example ERO application" required minLength={2} maxLength={120} aria-label="Form name" style={{ flex: "1 1 280px", width: "auto" }} />
                <label className="monarch-check" style={{ whiteSpace: "nowrap" }} title="Everyone who submits this form is added to Leads, with the form's name as their source."><input type="checkbox" name="add_to_leads" /> Forms-to-Leads: add respondents to Leads</label>
              </span>
              {result.data.brands.length > 1 && (
                <label>Which firm does this form belong to?{" "}
                  <select name="brand_domain_id" required defaultValue="">
                    <option value="" disabled>Choose a firm</option>
                    {result.data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>
              )}
              <button className="monarch-primary">Create form</button>
            </form>
          </section>
          <section className="monarch-panel">
            <div className="monarch-panel-head"><h2>{archived ? "Archived forms" : "Your forms"}</h2></div>
            <div style={{ padding: "0 20px" }}><ArchiveTabs base="/forms" view={view} counts={result.data.counts} /></div>
            <div className="monarch-table-wrap">
              <table>
                <thead><tr><th>NAME</th><th>STATUS</th><th>SUBMISSIONS</th><th>LAST SUBMISSION</th><th>PUBLIC LINK</th><th>{archived ? "ARCHIVED" : "UPDATED"}</th>{archived && <th />}</tr></thead>
                <tbody>
                  {result.data.rows.length === 0 ? (
                    <EmptyRow colSpan={archived ? 7 : 6}>{archived ? "No archived forms." : "No forms yet. Create your first one above."}</EmptyRow>
                  ) : (
                    result.data.rows.map(({ f, total, last, brand }) => (
                      <tr key={f.id}>
                        <td><Link href={`/forms/${f.id}`}><b>{f.name}</b></Link>{(brand || f.description) && <small className="monarch-subcell">{[brand, f.description].filter(Boolean).join(" · ")}</small>}</td>
                        <td><Badge value={f.status} /></td>
                        <td><Link href={`/forms/${f.id}/submissions`}>{total}</Link></td>
                        <td>{when(last)}</td>
                        <td>{f.current_version_id && f.status === "published" ? <code>/f/{f.public_id}</code> : "—"}</td>
                        <td>{archived ? when(f.archived_at ?? null) : when(f.updated_at)}</td>
                        {archived && <td><ArchiveRowButton entity="form" id={f.id} archived back="/forms?view=archived" /></td>}
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
