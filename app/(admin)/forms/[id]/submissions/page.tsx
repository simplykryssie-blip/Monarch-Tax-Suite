import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { formDeps } from "@/lib/forms/server";
import { REVIEW_STATUSES, type SubmissionStatus } from "@/lib/forms/types.ts";
import { Badge, EmptyRow, Flash, PageTitle, when } from "@/components/admin/ui";
import { FormTabs, formsLoad, FormsSetupRequired } from "@/components/forms/admin-bits";
import { emptySpamAction } from "../../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAGE = 50;

export default async function SubmissionsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string; status?: string; q?: string; page?: string; tests?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const status = (REVIEW_STATUSES as string[]).includes(sp.status ?? "") ? (sp.status as SubmissionStatus) : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const result = await formsLoad(async () => {
    const deps = formDeps();
    const form = await deps.repo.getForm(id);
    if (!form) return null;
    const list = await deps.repo.listSubmissions(form.id, { status, search: sp.q, limit: PAGE, offset: (page - 1) * PAGE, includeTests: sp.tests === "1" });
    return { form, ...list };
  });
  if (!result.ok) return <FormsSetupRequired message={result.message} />;
  if (!result.data) notFound();
  const { form, rows, total } = result.data;
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ status: status === "all" ? undefined : status, q: sp.q, tests: sp.tests, ...patch }).filter(([, v]) => v) as [string, string][]);
    const s = p.toString();
    return `/forms/${form.id}/submissions${s ? `?${s}` : ""}`;
  };
  return (
    <>
      <PageTitle title={form.name} back={{ href: "/forms", label: "Forms" }}>Submissions, newest first. Answers can&apos;t be edited after submission, and submissions are never deleted (spam can be emptied).</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      <FormTabs form={form} active="submissions" />
      <section className="monarch-panel" style={{ padding: 16 }}>
        <form className="monarch-inline-form" style={{ flexWrap: "wrap" }}>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name or email" aria-label="Search" />
          <select name="status" defaultValue={status} aria-label="Status"><option value="all">All statuses</option>{REVIEW_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
          <label className="monarch-check"><input type="checkbox" name="tests" value="1" defaultChecked={sp.tests === "1"} /> Include tests</label>
          <button className="monarch-secondary">Filter</button>
          <a className="monarch-secondary" href={`/forms/${form.id}/submissions/export`}>Export CSV</a>
          {status === "spam" && total > 0 && <span />}
        </form>
        {status === "spam" && total > 0 && (
          <form action={emptySpamAction} style={{ marginTop: 10 }}><input type="hidden" name="id" value={form.id} /><button className="monarch-secondary is-danger">Empty spam ({total})</button></form>
        )}
        <small className="monarch-muted">The CSV keeps identifiers masked and leaves out uploaded files. Each export is recorded.</small>
      </section>
      <section className="monarch-panel">
        <div className="monarch-table-wrap">
          <table>
            <thead><tr><th>#</th><th>RESPONDENT</th><th>SUBMITTED</th><th>STATUS</th><th>CUSTOMER</th><th>FIRM</th><th>PDF</th></tr></thead>
            <tbody>
              {rows.length === 0 ? <EmptyRow colSpan={7}>No submissions{sp.q || status !== "all" ? " match" : " yet"}.</EmptyRow> : rows.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/forms/${form.id}/submissions/${s.id}`}><b>#{s.number}</b></Link>{s.is_test && <small className="monarch-subcell">TEST</small>}</td>
                  <td>{s.respondent_name ?? "—"}<small className="monarch-subcell">{s.respondent_email ?? ""}</small></td>
                  <td>{when(s.submitted_at)}</td>
                  <td><Badge value={s.status} /></td>
                  <td>{s.customer_id ? <Link href={`/customers/${s.customer_id}`}>Open</Link> : "—"}</td>
                  <td>{s.organization_id ? <Link href={`/efin/org/${s.organization_id}`}>{s.firm_status === "created" ? "Created" : "Linked"}</Link> : s.firm_status === "failed" ? "Failed" : "—"}</td>
                  <td>{s.pdf_path ? <a href={`/forms/pdf/${s.id}`}>Download</a> : s.pdf_error ? "Retrying" : "Pending"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {total > PAGE && (
          <p style={{ padding: 12, display: "flex", gap: 12 }}>
            {page > 1 && <Link href={qs({ page: String(page - 1) })}>← Newer</Link>}
            <span className="monarch-muted">Page {page} of {Math.ceil(total / PAGE)}</span>
            {page * PAGE < total && <Link href={qs({ page: String(page + 1) })}>Older →</Link>}
          </p>
        )}
      </section>
    </>
  );
}
