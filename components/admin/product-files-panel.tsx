import { removeFileAction } from "@/app/(admin)/product-file-actions";
import { productFilesDeps } from "@/lib/admin";
import { FILE_EXTENSIONS, MAX_FILE_BYTES, MAX_FILES_PER_PRODUCT, MAX_PRODUCT_BYTES } from "@/lib/commerce/product-files.ts";
import type { Product } from "@/lib/commerce/types.ts";
import { FileUploader } from "./file-uploader";
import { when } from "./ui";

const size = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Code bundles and other files delivered to license holders. Stored privately and delivered only as downloads. */
export async function ProductFilesPanel({ product }: { product: Product }) {
  let data;
  try {
    const deps = productFilesDeps();
    const [files, downloads] = await Promise.all([deps.files.listFiles(product.id), deps.files.listDownloads({ productId: product.id }, 500)]);
    data = { files: files.filter((f) => f.status === "ready"), downloads };
  } catch {
    return <section className="monarch-panel monarch-pad"><h2 className="monarch-h2">Product files</h2><p className="monarch-muted">Product files are not available yet. Apply the migration 20261013100000_product_files.sql.</p></section>;
  }
  const counts = new Map<string, number>();
  for (const d of data.downloads) counts.set(d.product_file_id, (counts.get(d.product_file_id) ?? 0) + 1);
  const licensed = product.access_type === "license";
  return (
    <section className="monarch-panel monarch-pad">
      <h2 className="monarch-h2">Product files</h2>
      <p className="monarch-muted">
        Code bundles and files buyers download ({FILE_EXTENSIONS.map((e) => `.${e}`).join(", ")}; up to {size(MAX_FILE_BYTES)} each, {size(MAX_PRODUCT_BYTES)} and {MAX_FILES_PER_PRODUCT} files per product).
        Files are stored privately and are <b>never run on this site</b>: buyers with an active license download them from <code>/downloads</code> and install them themselves. Every download is logged.
      </p>
      {!licensed && <p className="monarch-alert is-error">Downloads are delivered to license holders, so this product needs the License access type before buyers can download its files.</p>}
      {data.files.length === 0 ? (
        <p className="monarch-muted">No files yet.</p>
      ) : (
        <div className="monarch-table-wrap">
          <table>
            <thead><tr><th>FILE</th><th>SIZE</th><th>UPLOADED</th><th>DOWNLOADS</th><th /></tr></thead>
            <tbody>
              {data.files.map((f) => (
                <tr key={f.id}>
                  <td><code>{f.file_name}</code></td>
                  <td>{size(f.size_bytes)}</td>
                  <td>{when(f.ready_at ?? f.created_at)}</td>
                  <td>{counts.get(f.id) ?? 0}</td>
                  <td>
                    <form action={removeFileAction}>
                      <input type="hidden" name="product_id" value={product.id} />
                      <input type="hidden" name="file_id" value={f.id} />
                      <button className="monarch-secondary" type="submit" title="Buyers can no longer download it, starting now. Download history is kept. The stored file is permanently deleted after 24 hours and can&apos;t be recovered after that.">Remove</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {product.status !== "archived" && <FileUploader productId={product.id} accept={FILE_EXTENSIONS.map((e) => `.${e}`).join(",")} />}
    </section>
  );
}
