import Link from "next/link";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { PRODUCT_CATEGORIES, PRODUCT_STATUSES } from "@/lib/commerce/types.ts";
import { categoryLabel, formatPrice } from "@/components/storefront/product-view";
import { imagesByProduct, toStorefrontImages } from "@/lib/storefront";
import { duplicateProductAction } from "../product-actions";
import { Badge, EmptyRow, Flash, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { ArchiveRowButton, ArchiveTabs } from "@/components/admin/archive";
import { inView, viewCounts, viewOf } from "@/lib/archive.ts";

type Search = { notice?: string; error?: string; q?: string; status?: string; category?: string; view?: string };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const { notice, error, q = "", status = "", category = "", view: rawView } = await searchParams;
  const view = viewOf(rawView);
  const result = await load(async () => {
    const products = await commerceRepo().listProducts();
    return { products, images: await imagesByProduct(products.map((p) => p.id)) };
  });
  const term = q.trim().toLowerCase();
  const rows = result.ok
    ? inView(result.data.products, view).filter(
        (p) =>
          (!term || p.name.toLowerCase().includes(term) || p.slug.includes(term) || (p.stripe_product_id ?? "").toLowerCase().includes(term)) &&
          (!status || p.status === status) &&
          (!category || p.category === category),
      )
    : [];

  return (
    <>
      <PageTitle title="Products">Tax software, Service Bureau packages, digital products, courses and annual updates.</PageTitle>
      <Flash notice={notice} error={error} />
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : (
        <>
          <div className="monarch-page-actions">
            <span>Catalog · {rows.length} of {result.data.products.length} products</span>
            <Link className="monarch-primary" href="/products/new">＋ Add product</Link>
          </div>
          <form className="pl-filters" role="search">
            <input name="q" defaultValue={q} placeholder="Search name, identifier or Stripe ID" aria-label="Search products" />
            <select name="status" defaultValue={status} aria-label="Status">
              <option value="">All statuses</option>
              {PRODUCT_STATUSES.filter((s) => s !== "archived").map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
            <select name="category" defaultValue={category} aria-label="Category">
              <option value="">All categories</option>
              {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
            </select>
            {view === "archived" && <input type="hidden" name="view" value="archived" />}
            <button className="monarch-secondary" type="submit">Filter</button>
            {(q || status || category) && <Link className="monarch-secondary" href={view === "archived" ? "/products?view=archived" : "/products"}>Clear</Link>}
          </form>
          <section className="monarch-panel">
            <div style={{ padding: "0 20px" }}><ArchiveTabs base="/products" view={view} counts={viewCounts(result.data.products)} keep={{ q, category }} /></div>
            <div className="monarch-table-wrap">
              <table>
                <thead><tr><th></th><th>PRODUCT</th><th>CATEGORY</th><th>PRICE</th><th>STATUS</th><th>UPDATED</th><th></th></tr></thead>
                <tbody>
                  {rows.length === 0 ? (
                    <EmptyRow colSpan={7}>{view === "archived" ? "No archived products." : result.data.products.length ? "No products match these filters." : "No products in the catalog yet."}</EmptyRow>
                  ) : (
                    rows.map((p) => {
                      const [thumb] = toStorefrontImages(result.data.images.get(p.id) ?? []);
                      return (
                        <tr key={p.id}>
                          <td className="pl-thumb">
                            {/* eslint-disable-next-line @next/next/no-img-element -- storage URL */}
                            {thumb ? <img src={thumb.url} alt={thumb.alt ?? p.name} /> : <span aria-label="No image">♛</span>}
                          </td>
                          <td><Link href={`/products/${p.id}`}><b>{p.name}</b></Link><small className="monarch-subcell">{p.slug}</small></td>
                          <td>{categoryLabel(p.category)}</td>
                          <td>{formatPrice(p)}</td>
                          <td><Badge value={p.status} /></td>
                          <td>{view === "archived" ? when(p.archived_at ?? null) : when(p.updated_at)}</td>
                          <td>
                            <div className="pl-actions">
                              <Link className="monarch-secondary" href={`/products/${p.id}`}>Edit</Link>
                              <a className="monarch-secondary" href={`/preview/product/${p.id}`} target="_blank" rel="noopener">Preview</a>
                              {view === "archived" && <ArchiveRowButton entity="product" id={p.id} archived back="/products?view=archived" />}
                              <form action={duplicateProductAction}><input type="hidden" name="id" value={p.id} /><button className="monarch-secondary" type="submit">Duplicate</button></form>
                            </div>
                          </td>
                        </tr>
                      );
                    })
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
