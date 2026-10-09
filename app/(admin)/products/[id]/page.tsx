import Link from "next/link";
import { notFound } from "next/navigation";
import { commerceRepo, imageStore, requireAdmin } from "@/lib/admin";
import { MAX_IMAGES_PER_PRODUCT } from "@/lib/commerce/images.ts";
import { publishBlockers } from "@/lib/commerce/validation.ts";
import { orderedImages, toStorefrontImages } from "@/lib/storefront";
import { setProductStatusAction } from "../../actions";
import { duplicateProductAction } from "../../product-actions";
import { ImageManager } from "@/components/admin/image-manager";
import { ProductEditor } from "@/components/admin/product-editor";
import { StripePanel } from "@/components/admin/stripe-panel";
import { VersionsPanel } from "@/components/admin/versions-panel";
import { Badge, Flash, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";

const NEXT: Record<string, { status: string; label: string }[]> = {
  draft: [{ status: "published", label: "Publish" }, { status: "archived", label: "Archive" }],
  published: [{ status: "unpublished", label: "Unpublish" }, { status: "archived", label: "Archive" }],
  unpublished: [{ status: "published", label: "Publish" }, { status: "archived", label: "Archive" }],
  archived: [],
};

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const repo = commerceRepo();
  const result = await load(async () => {
    const product = await repo.getProduct(id);
    if (!product) return { product: null, versions: [], changes: {}, images: [] };
    const [versions, images] = await Promise.all([repo.listVersions(product.id), repo.listProductImages([product.id])]);
    const changes = Object.fromEntries(await Promise.all(versions.map(async (v) => [v.id, await repo.listVersionChanges(v.id)] as const)));
    return { product, versions, changes, images };
  });
  if (!result.ok) return <SetupRequired message={result.message} />;
  const { product, versions, changes, images } = result.data;
  if (!product) notFound();
  const blockers = publishBlockers(product);
  const store = imageStore();
  const managed = orderedImages(images).map((i) => ({ id: i.id, url: store.publicUrl(i.storage_path), alt: i.alt_text, is_primary: i.is_primary, width: i.width, height: i.height, size_bytes: i.size_bytes }));
  const archived = product.status === "archived";

  return (
    <>
      <PageTitle title={product.name} back={{ href: "/products", label: "Products" }}>
        <Badge value={product.status} /> · Updated {when(product.updated_at)}
      </PageTitle>
      <Flash {...await searchParams} />
      <section className="monarch-panel monarch-pad monarch-status-bar">
        <div>
          <b>Status: </b><Badge value={product.status} />
          {product.status === "published" && <span className="monarch-muted"> Active — visible in the storefront at <Link href={`/shop/${product.slug}`}>/shop/{product.slug}</Link></span>}
          {product.status !== "published" && <span className="monarch-muted"> Hidden from customers.</span>}
          {!archived && product.status !== "published" && blockers.length > 0 && <p className="monarch-muted">Before publishing: {blockers.join(" ")}</p>}
        </div>
        <div className="monarch-inline-actions">
          <a className="monarch-secondary" href={`/preview/product/${product.id}`} target="_blank" rel="noopener">Preview ↗</a>
          <form action={duplicateProductAction}>
            <input type="hidden" name="id" value={product.id} />
            <button className="monarch-secondary" type="submit">Duplicate</button>
          </form>
          {NEXT[product.status].map((n) => (
            <form key={n.status} action={setProductStatusAction}>
              <input type="hidden" name="id" value={product.id} />
              <input type="hidden" name="status" value={n.status} />
              <button className={n.status === "archived" ? "monarch-secondary is-danger" : "monarch-secondary"} type="submit">{n.label}</button>
            </form>
          ))}
        </div>
      </section>
      {archived && (
        <div className="monarch-notice">
          <b>ARCHIVED</b> Archived products are read-only and hidden from sale. Existing orders, licenses and installations are kept. Use Duplicate to start a new draft from it.
        </div>
      )}
      <ImageManager productId={product.id} images={managed} readOnly={archived} max={MAX_IMAGES_PER_PRODUCT} />
      {!archived && (
        <section className="monarch-panel monarch-pad">
          <h2 className="monarch-h2">Product details</h2>
          <ProductEditor key={product.updated_at} product={product} images={toStorefrontImages(images)} hasVersions={versions.length > 0} />
        </section>
      )}
      <StripePanel product={product} stripeConfigured={Boolean(process.env.STRIPE_SECRET_KEY)} />
      <VersionsPanel productId={product.id} versions={versions} changes={changes} />
    </>
  );
}
