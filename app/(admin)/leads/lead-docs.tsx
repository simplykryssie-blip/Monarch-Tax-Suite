import { when } from "@/components/admin/ui";
import { leadDocsDeps } from "@/lib/leads/docs-server";
import { downloadLeadDocAction } from "./doc-actions";

const size = (b: number | null) => (b === null ? "" : b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** A lead's documents: the PDFs of forms they completed. When the lead becomes a client these move to the client's files. */
export async function LeadDocs({ leadId, back }: { leadId: string; back: string }) {
  const docs = await leadDocsDeps().db.listLeadDocs(leadId).catch(() => null);
  if (docs === null) return null;
  return (
    <section className="monarch-panel" id="lead-documents">
      <div className="monarch-panel-head"><div><h2>Documents</h2><p>Forms this lead completed. If they become a client, these move to the client&apos;s Documents.</p></div></div>
      {docs.length === 0 ? <p className="monarch-muted" style={{ padding: "0 20px 20px" }}>No documents yet.</p> : (
        <div className="monarch-table-wrap"><table>
          <thead><tr><th>DOCUMENT</th><th>ADDED</th><th>SIZE</th><th></th></tr></thead>
          <tbody>{docs.map((d) => (
            <tr key={d.id}>
              <td><b>{d.title}</b></td>
              <td>{when(d.created_at)}</td>
              <td>{size(d.size_bytes)}</td>
              <td><form action={downloadLeadDocAction}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={back} /><button className="monarch-secondary efin-small">Download</button></form></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
