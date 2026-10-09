import Link from "next/link";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { Badge, EmptyRow, Flash, label, load, money, PageTitle, SetupRequired } from "@/components/admin/ui";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const flash = await searchParams;
  const result = await load(() => commerceRepo().listProducts());
  return (
    <>
      <PageTitle title="Products">Manage software, downloads, courses, memberships, and services.</PageTitle>
      <Flash {...flash} />
      {!result.ok ? (
        <SetupRequired message={result.message} />
      ) : (
        <>
          <div className="monarch-page-actions">
            <span>Catalog · {result.data.length} products</span>
            <Link className="monarch-primary" href="/products/new">＋ Add product</Link>
          </div>
          <section className="monarch-panel">
            <div className="monarch-table-wrap">
              <table>
                <thead><tr><th>PRODUCT</th><th>TYPE</th><th>ACCESS</th><th>INSTALLATION</th><th>PRICE</th><th>STATUS</th></tr></thead>
                <tbody>
                  {result.data.length === 0 ? (
                    <EmptyRow colSpan={6}>No products in the catalog yet.</EmptyRow>
                  ) : (
                    result.data.map((p) => (
                      <tr key={p.id}>
                        <td><Link href={`/products/${p.id}`}><b>{p.name}</b></Link><small className="monarch-subcell">{p.slug}</small></td>
                        <td>{label(p.product_type)}</td>
                        <td>{label(p.access_type)}</td>
                        <td>{p.installation_options.map(label).join(", ") || "—"}</td>
                        <td>{money(p.price_cents, p.currency)}</td>
                        <td><Badge value={p.status} /></td>
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
