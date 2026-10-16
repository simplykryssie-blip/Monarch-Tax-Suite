import { appOrigin, imageStore, tenantDb } from "@/lib/admin";
import { EmptyRow, Flash, load, PageTitle, when } from "@/components/admin/ui";
import { SubmitOnce } from "@/components/admin/submit-once";
import { emailMarkdown } from "@/lib/images/service.ts";
import { SupabaseImagesRepo } from "@/lib/images/supabase-repo";
import { deleteLibraryImageAction, uploadLibraryImageAction } from "../actions";

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Pictures for emails, kept in this account's own private storage. */
export default async function ImagesPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { notice, error } = await searchParams;
  const result = await load(() => new SupabaseImagesRepo(tenantDb()).list(200));
  const store = imageStore(await appOrigin());
  return (
    <>
      <PageTitle title="Images">Pictures for your emails. They are kept in your account&apos;s own private storage, which no other account can see. Deleting a picture deletes its file too.</PageTitle>
      <Flash notice={notice} error={error} />
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2>Upload a picture</h2>
        <form action={uploadLibraryImageAction} className="monarch-inline-form" style={{ flexWrap: "wrap" }}>
          <input type="file" name="file" required accept="image/png,image/jpeg,image/webp" aria-label="Picture (PNG, JPG or WebP, up to 4 MB)" />
          <input name="alt" maxLength={200} placeholder="Describe the picture" aria-label="Picture description" />
          <SubmitOnce className="monarch-primary" busy="Uploading…">Upload</SubmitOnce>
        </form>
        <p className="monarch-muted">PNG, JPG or WebP, up to 4 MB. You can also upload straight from the Picture button while writing an email template.</p>
      </section>
      {!result.ok ? (
        <div className="monarch-notice"><b>DATABASE SETUP REQUIRED</b> Apply <code>supabase/migrations/20261031090000_tenant_storage_and_sending.sql</code>, then reload. <small>({result.message})</small></div>
      ) : (
        <section className="monarch-panel">
          <div className="monarch-panel-head"><div><h2>Your pictures</h2></div></div>
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>PICTURE</th><th>NAME</th><th>EMAIL CODE</th><th>ADDED</th><th></th></tr></thead>
            <tbody>
              {result.data.length === 0 ? <EmptyRow colSpan={5}>No pictures yet.</EmptyRow> : result.data.map((i) => {
                const url = store.publicUrl(i.storage_path);
                return (
                  <tr key={i.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <td><img src={url} alt={i.alt_text ?? ""} style={{ maxWidth: 120, maxHeight: 80, objectFit: "contain" }} /></td>
                    <td><b>{i.file_name}</b><small className="monarch-subcell">{i.width && i.height ? `${i.width}×${i.height} · ` : ""}{kb(i.size_bytes)}</small></td>
                    <td><input readOnly value={emailMarkdown(url, i.alt_text)} aria-label={`Email code for ${i.file_name}`} style={{ width: "100%", minWidth: 220 }} /></td>
                    <td>{when(i.created_at)}</td>
                    <td>
                      <form action={deleteLibraryImageAction} className="monarch-inline-form">
                        <input type="hidden" name="id" value={i.id} />
                        <label><input type="checkbox" name="confirm" required /> Sure</label>
                        <button className="monarch-link is-danger">Delete</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </section>
      )}
    </>
  );
}
