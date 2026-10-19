import type { Metadata } from "next";
import Link from "next/link";
import { categoryLabel, formatPrice } from "@/components/storefront/product-view";
import { LEGAL_PAGES_APPROVED } from "@/lib/legal";
import { Stars } from "@/components/storefront/stars";
import { reviewsRepo } from "@/lib/reviews/server";
import { imagesByProduct, publishedProducts, toStorefrontImages } from "@/lib/storefront";

export const metadata: Metadata = { title: "Shop | Monarch Tax Suite", description: "Monarch Tax Suite software, packages, guides and courses." };
export const dynamic = "force-dynamic";

/** Public catalog: published products only. */
export default async function ShopPage() {
  const products = await publishedProducts();
  const images = await imagesByProduct(products.map((p) => p.id));
  const ratings = await reviewsRepo().ratingsByProduct(products.map((p) => p.id)).catch(() => new Map<string, number[]>());
  return (
    <main className="sf-page">
      <header className="sf-shop-head">
        <div className="sf-eyebrow">MONARCH TAX SUITE</div>
        <h1>Shop</h1>
      </header>
      {products.length === 0 ? (
        <p className="sf-empty">No products are available right now. Contact <a href="mailto:support@verexahq.com">support@verexahq.com</a>.</p>
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
                  {(ratings.get(p.id)?.length ?? 0) > 0 && (() => { const r = ratings.get(p.id)!; const avg = r.reduce((n, x) => n + x, 0) / r.length; return <span className="sf-card-stars"><Stars value={avg} size={14} />{avg.toFixed(1)} ({r.length})</span>; })()}
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
