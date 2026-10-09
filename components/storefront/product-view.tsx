// Customer-facing product page. Pure presentation: used by the public /shop
// pages, the admin preview, and the editor's live preview, so all three match.

export type StorefrontProduct = {
  name: string;
  description: string | null;
  category: string;
  price_cents: number | null;
  currency: string;
  payment_type: "one_time" | "recurring";
  billing_interval: "month" | "year" | null;
  features: string[];
  terms: string | null;
  disclaimer: string | null;
  metadata: Record<string, string>;
};

export type StorefrontImage = { url: string; alt: string | null };

const CATEGORY_LABELS: Record<string, string> = {
  tax_software: "Tax software",
  service_bureau: "Service Bureau package",
  digital_product: "Digital book / template / guide",
  course: "Course & training",
  software_update: "Annual software update",
  other: "Monarch product",
};

export const categoryLabel = (c: string) => CATEGORY_LABELS[c] ?? "Monarch product";

export function formatPrice(p: Pick<StorefrontProduct, "price_cents" | "currency" | "payment_type" | "billing_interval">) {
  if (p.price_cents === null) return "Price coming soon";
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency.toUpperCase() }).format(p.price_cents / 100);
  return p.payment_type === "recurring" && p.billing_interval ? `${amount} / ${p.billing_interval}` : `${amount} one-time`;
}

function safeCheckoutUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function ProductView({ product, images, preview = false }: { product: StorefrontProduct; images: StorefrontImage[]; preview?: boolean }) {
  const [hero, ...rest] = images;
  const checkout = preview ? null : safeCheckoutUrl(product.metadata.checkout_url);
  return (
    <article className="sf">
      <div className="sf-grid">
        <div className="sf-media">
          {hero ? (
            // eslint-disable-next-line @next/next/no-img-element -- storage URLs are arbitrary; plain img keeps previews exact
            <img className="sf-hero" src={hero.url} alt={hero.alt ?? product.name} />
          ) : (
            <div className="sf-placeholder" aria-label="No product image yet">
              <span>♛</span>
              <small>{categoryLabel(product.category)}</small>
            </div>
          )}
          {rest.length > 0 && (
            <div className="sf-thumbs">
              {rest.map((img) => (
                // eslint-disable-next-line @next/next/no-img-element -- see above
                <img key={img.url} src={img.url} alt={img.alt ?? product.name} />
              ))}
            </div>
          )}
        </div>
        <div className="sf-info">
          <div className="sf-eyebrow">MONARCH TAX SUITE · {categoryLabel(product.category).toUpperCase()}</div>
          <h1>{product.name || "Untitled product"}</h1>
          <div className="sf-price">{formatPrice(product)}</div>
          {product.description && <p className="sf-desc">{product.description}</p>}
          <div className="sf-cta">
            {preview ? (
              <button type="button" disabled title="Preview only — purchasing is disabled">Purchase (preview only)</button>
            ) : checkout ? (
              <a href={checkout} rel="noopener">Purchase</a>
            ) : (
              <a href={`mailto:info@monarchtaxsuite.com?subject=${encodeURIComponent(product.name)}`}>Contact us to purchase</a>
            )}
            <small>{product.payment_type === "one_time" ? "One-time payment. No subscription." : `Billed every ${product.billing_interval}. Cancel anytime.`}</small>
          </div>
        </div>
      </div>
      {product.features.length > 0 && (
        <section className="sf-section">
          <h2>What&apos;s included</h2>
          <ul className="sf-features">{product.features.map((f) => <li key={f}>{f}</li>)}</ul>
        </section>
      )}
      {(product.terms || product.disclaimer) && (
        <section className="sf-section sf-fine">
          {product.terms && (<><h2>Terms, refunds &amp; transfers</h2><p>{product.terms}</p></>)}
          {product.disclaimer && (<><h2>Disclaimer</h2><p>{product.disclaimer}</p></>)}
        </section>
      )}
    </article>
  );
}
