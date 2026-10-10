import type { Metadata } from "next";
import Link from "next/link";
import { categoryLabel, formatPrice } from "@/components/storefront/product-view";
import { LEGAL_PAGES_APPROVED } from "@/lib/legal";
import { imagesByProduct, publishedProducts, toStorefrontImages } from "@/lib/storefront";

export const metadata: Metadata = { title: "Shop | Monarch Tax Suite", description: "Monarch Tax Suite software, packages, guides and courses." };
export const dynamic = "force-dynamic";

/** Public catalog: published products only. */
export default async function ShopPage() {
  const products = await publishedProducts();
  const images = await imagesByProduct(products.map((p) => p.id));
  return (
    <main className="sf-page">
      <header className="sf-shop-head">
        <div className="sf-eyebrow">MONARCH TAX SUITE</div>
        <h1>Shop</h1>
      </header>
      {products.length === 0 ? (
        <p className="sf-empty">No products are available right now. Contact <a href="mailto:info@monarchtaxsuite.com">info@monarchtaxsuite.com</a>.</p>
      ) : (
        <ul className="sf-shop">
          {products.map((p) => {
            const [img] = toStorefrontImages(images.get(p.id) ?? []);
            return (
              <li key={p.id} className="sf-card">
                <Link href={`/shop/${p.slug}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- storage URL */}
                  {img ? <img src={img.url} alt={img.alt ?? p.name} /> : <div className="sf-placeholder"><span>♛</span></div>}
                  <small>{categoryLabel(p.category)}</small>
                  <b>{p.name}</b>
                  <span>{formatPrice(p)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {LEGAL_PAGES_APPROVED && (
        <footer style={{ marginTop: 40, fontSize: 14, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/refunds">Refund Policy</Link>
        </footer>
      )}
    </main>
  );
}
