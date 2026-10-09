import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { commerceRepo, requireAdmin } from "@/lib/admin";
import { toStorefrontImages } from "@/lib/storefront";
import { DeviceFrame } from "@/components/storefront/device-frame";
import { ProductView } from "@/components/storefront/product-view";

export const metadata: Metadata = { title: "Product preview | Monarch Tax Suite", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Administrator-only preview of any product, including drafts. Read-only: it never publishes, orders or charges. */
export default async function ProductPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const repo = commerceRepo();
  const product = await repo.getProduct(id);
  if (!product) notFound();
  const images = toStorefrontImages(await repo.listProductImages([product.id]));
  return (
    <main className="sf-page">
      <div className="sf-preview-banner" role="status">
        <b>PREVIEW</b> {product.status === "published" ? "This product is live in the storefront." : `This product is ${product.status} and hidden from customers.`}{" "}
        Purchasing is disabled here. <Link href={`/products/${product.id}`}>Back to editor</Link>
      </div>
      <DeviceFrame>
        <ProductView preview product={product} images={images} />
      </DeviceFrame>
    </main>
  );
}
