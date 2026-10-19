import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { EmptyRow, Flash, load, SetupRequired, when } from "@/components/admin/ui";
import { Icon } from "@/components/admin/icons";
import { loadSnapshot, MAX_DOC_BYTES } from "@/lib/efin/service";
import { DOC_KINDS } from "@/lib/efin/types.ts";
import { deleteDocumentAction, uploadDocumentAction } from "../../actions";
import { ActionForm } from "../../action-form";
import { Select, VERIFY_OPTIONS, Verified } from "../../parts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A firm's documents: opened from Firm details, so there is no Documents tab. */
export default async function Documents({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ from?: string; add?: string; notice?: string; error?: string }> }) {
  await requireAdmin();
  const { orgId } = await params;
  const sp = await searchParams;
  const result = await load(loadSnapshot);
  if (!result.ok) return <SetupRequired message={result.message} module="efin" />;
  const s = result.data;
  const org = s.orgs.find((o) => o.id === orgId);
  if (!org) notFound();
  const efinId = sp.from && UUID.test(sp.from) && s.efins.some((e) => e.id === sp.from && e.organization_id === orgId) ? sp.from : s.efins.find((e) => e.organization_id === orgId && !e.archived_at)?.id;
  const firmHref = efinId ? `/efin/${efinId}` : `/efin/org/${orgId}`;
  const here = `/efin/documents/${orgId}${efinId ? `?from=${efinId}` : ""}`;
  const docs = s.documents.filter((d) => d.subject_type === "organization" && d.subject_id === orgId);
  return (
    <>
      <nav className="efin-crumbs" aria-label="Breadcrumb">
        <Link href="/efin" aria-label="My Service Bureau"><Icon name="home" size={16} /></Link>
        <Link href="/efin">My Service Bureau</Link><span>›</span>
        <Link href="/efin/list">EROs & EFINs</Link><span>›</span>
        <Link href={firmHref}>{org.legal_name}</Link><span>›</span>
        <b>Documents</b>
      </nav>
      <div className="efin-loc-head">
        <div>
          <h1 className="efin-edit-title">Documents</h1>
          <p className="monarch-muted" style={{ margin: 0 }}>{org.legal_name} · {docs.length} document{docs.length === 1 ? "" : "s"}</p>
        </div>
        <Link className="monarch-primary" href={`${here}${here.includes("?") ? "&" : "?"}add=1#upload`}><Icon name="plus" size={16} /> Upload document</Link>
      </div>
      <Flash notice={sp.notice} error={sp.error} />
      <div className="efin-flow">
        <details className="efin-edit" id="upload" open={sp.add === "1"}>
          <summary>Upload a document</summary>
          <div className="efin-edit-body">
            <ActionForm action={uploadDocumentAction} className="monarch-form">
              <input type="hidden" name="organization_id" value={orgId} /><input type="hidden" name="back" value={here} />
              <label>File (PDF, PNG, JPG or DOCX, up to {MAX_DOC_BYTES / 1024 / 1024} MB)<input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.docx" /></label>
              <label>Type<Select name="kind" value="Other" options={DOC_KINDS.map((k) => ({ value: k, label: k }))} /></label>
              <label>Title (optional)<input name="title" maxLength={200} placeholder="Defaults to the file name" /></label>
              <label>Confirmed?<Select name="verification_status" value="unverified" options={VERIFY_OPTIONS} /></label>
              <label className="is-wide">Notes<input name="notes" maxLength={2000} /></label>
              <p className="efin-note is-wide" style={{ padding: 0 }}>Files are stored privately. Every upload, download and deletion is recorded in the history.</p>
              <div className="is-wide"><button className="monarch-primary" type="submit">Upload</button></div>
            </ActionForm>
          </div>
        </details>

        <section className="monarch-panel">
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>DOCUMENT</th><th>TYPE</th><th>CONFIRMED</th><th>ADDED</th><th></th></tr></thead>
            <tbody>
              {docs.length === 0 ? <EmptyRow colSpan={5}>No documents yet. Use Upload document to add the first one.</EmptyRow> : docs.map((d) => (
                <tr key={d.id}>
                  <td><b>{d.title}</b>{d.notes && <div className="monarch-muted">{d.notes}</div>}</td>
                  <td>{d.kind}</td>
                  <td><Verified value={d.verification_status} /></td>
                  <td>{when(d.created_at)}</td>
                  <td>
                    <div className="efin-actions" style={{ justifyContent: "flex-end" }}>
                      <a className="monarch-secondary efin-small" href={`/efin/documents/file/${d.id}`}>Download</a>
                      <ActionForm action={deleteDocumentAction} confirm={`Permanently delete ${d.title}?`}>
                        <input type="hidden" name="id" value={d.id} /><input type="hidden" name="confirm" value="on" /><input type="hidden" name="back" value={here} />
                        <button className="monarch-secondary is-danger efin-small" type="submit">Delete</button>
                      </ActionForm>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
        <p className="efin-note" style={{ padding: 0 }}>These are your own records. Uploading a file does not confirm anything with the IRS.</p>
      </div>
    </>
  );
}
