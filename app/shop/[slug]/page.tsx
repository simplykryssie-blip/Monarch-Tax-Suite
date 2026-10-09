import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductView } from "@/components/storefront/product-view";
import { commerceRepo } from "@/lib/admin";
import { publishedProductBySlug, toStorefrontImages } from "@/lib/storefront";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const product = await publishedProductBySlug((await params).slug);
  return product ? { title: `${product.name} | Monarch Tax Suite`, description: product.description?.slice(0, 160) } : { title: "Not found | Monarch Tax Suite" };
}

/** Public product page. Drafts, unpublished and archived products return 404. */
export default async function ShopProductPage({ params }: Params) {
  const product = await publishedProductBySlug((await params).slug);
  if (!product) notFound();
  const images = toStorefrontImages(await commerceRepo().listProductImages([product.id]));
  return (
    <main className="sf-page">
      <Link className="sf-back" href="/shop">← All products</Link>
      <div className="sf-frame is-desktop is-fluid">
        <ProductView product={product} images={images} />
      </div>
    </main>
  );
}
