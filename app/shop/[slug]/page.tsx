import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BuyForm } from "@/components/storefront/buy-form";
import { LEGAL_PAGES_APPROVED } from "@/lib/legal";
import { ProductView } from "@/components/storefront/product-view";
import { commerceRepo } from "@/lib/admin";
import { shareMeta } from "@/lib/site-meta";
import { publishedProductBySlug, toStorefrontImages } from "@/lib/storefront";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }>; searchParams?: Promise<{ error?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const product = await publishedProductBySlug((await params).slug);
  if (!product) return { title: "Not found | Monarch Tax Suite" };
  const description = product.description?.slice(0, 160);
  return { title: `${product.name} | Monarch Tax Suite`, description, ...shareMeta({ title: product.name, description, path: `/shop/${product.slug}` }) };
}

/** Public product page. Drafts, unpublished and archived products return 404. */
export default async function ShopProductPage({ params, searchParams }: Params) {
  const product = await publishedProductBySlug((await params).slug);
  const error = (await searchParams)?.error?.slice(0, 300);
  if (!product) notFound();
  const images = toStorefrontImages(await commerceRepo().listProductImages([product.id]));
  return (
    <main className="sf-page">
      <Link className="sf-back" href="/shop">← All products</Link>
      <div className="sf-frame is-desktop is-fluid">
        <ProductView
          product={product}
          images={images}
          // Buyers must accept the published Terms and Refund Policy, so checkout exists only while they are approved.
          purchase={LEGAL_PAGES_APPROVED ? <BuyForm slug={product.slug} installationOptions={product.installation_options} licensed={product.access_type === "license"} error={error} wisp={product.metadata?.delivery === "wisp_generator"} /> : undefined}
        />
      </div>
    </main>
  );
}
