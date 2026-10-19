import { productFilesDeps } from "@/lib/admin";
import { EmptyRow, when } from "./ui";

/** Every file download handed out for a license: what, and when. */
export async function LicenseDownloadsPanel({ licenseId }: { licenseId: string }) {
  let downloads;
  try {
    downloads = await productFilesDeps().files.listDownloads({ licenseId }, 50);
  } catch {
    return null;
  }
  return (
    <section className="monarch-panel">
      <div className="monarch-panel-head"><div><h2>Downloads</h2><p>Files this license holder downloaded from /downloads, newest first.</p></div></div>
      <div className="monarch-table-wrap">
        <table>
          <thead><tr><th>WHEN</th><th>FILE</th></tr></thead>
          <tbody>
            {downloads.length === 0 ? <EmptyRow colSpan={2}>No downloads yet.</EmptyRow> : downloads.map((d) => (
              <tr key={d.id}><td>{when(d.created_at)}</td><td><code>{d.file_name}</code></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
