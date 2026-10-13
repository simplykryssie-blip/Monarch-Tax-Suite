import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { documentDeps } from "@/lib/documents/server";
import { Badge, EmptyRow, Flash, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { DocumentUploader } from "@/components/admin/document-uploader";
import { ArchiveRowButton, ArchiveTabs } from "@/components/admin/archive";
import { inView, viewCounts, viewOf } from "@/lib/archive.ts";

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ view?: string; notice?: string; error?: string }> }) {
  await requireAdmin();
  const { notice, error, view: rawView } = await searchParams;
  const view = viewOf(rawView);
  const result = await load(async () => {
    const deps = documentDeps();
    const documents = await deps.repo.listDocuments();
    const rows = await Promise.all(documents.map(async (d) => {
      const version = d.current_version_id ? await deps.repo.getVersion(d.current_version_id) : null;
      return { d, version, sent: await deps.repo.countDeliveries(d.id) };
    }));
    return rows;
  });
  return (
    <>
      <PageTitle title="Documents">Your document library: upload PDFs and Word files, turn them into templates with merge fields, and send them from workflows.</PageTitle>
      <Flash notice={notice} error={error} />
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : (
        <>
          <section className="monarch-panel" style={{ padding: 20 }}>
            <h2>Add a document</h2>
            <DocumentUploader />
            <p className="monarch-muted">PDF or Word (.docx), up to 25 MB. In Word, type merge fields like {"{{client_name}}"} in the text. In a PDF, name fillable form fields after the merge field. For documents sent by a workflow that starts on a form submission, {"{{form.question_key}}"} fills in that answer. Only PDFs can be signed: export to PDF before uploading a document that needs a signature.</p>
          </section>
          <section className="monarch-panel">
            <div style={{ padding: "0 20px" }}><ArchiveTabs base="/documents" view={view} counts={viewCounts(result.data.map((r) => r.d))} /></div>
            <div className="monarch-table-wrap">
              <table>
                <thead><tr><th>NAME</th><th>TYPE</th><th>TEMPLATE</th><th>STATUS</th><th>VERSION</th><th>SENT</th><th>{view === "archived" ? "ARCHIVED" : "UPDATED"}</th>{view === "archived" && <th />}</tr></thead>
                <tbody>
                  {result.data.filter((r) => inView([r.d], view).length).length === 0 ? (
                    <EmptyRow colSpan={view === "archived" ? 8 : 7}>{view === "archived" ? "No archived documents." : "No documents yet. Upload your first one above."}</EmptyRow>
                  ) : (
                    result.data.filter((r) => inView([r.d], view).length).map(({ d, version, sent }) => (
                      <tr key={d.id}>
                        <td><Link href={`/documents/${d.id}`}><b>{d.name}</b></Link>{d.description && <small className="monarch-subcell">{d.description}</small>}</td>
                        <td>{d.file_type.toUpperCase()}</td>
                        <td>{version?.merge_fields.length ? `${version.merge_fields.length} field${version.merge_fields.length > 1 ? "s" : ""}` : "Plain"}</td>
                        <td><Badge value={d.status} /></td>
                        <td>{version ? `v${version.version}` : "—"}</td>
                        <td>{sent}</td>
                        <td>{view === "archived" ? when(d.archived_at ?? null) : when(d.updated_at)}</td>
                        {view === "archived" && <td><ArchiveRowButton entity="document" id={d.id} archived back="/documents?view=archived" /></td>}
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
