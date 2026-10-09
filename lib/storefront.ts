import "server-only";
import { commerceRepo, imageStore } from "./admin";
import { isStorefrontVisible } from "./commerce/catalog.ts";
import type { Product, ProductImage } from "./commerce/types.ts";
import type { StorefrontImage } from "@/components/storefront/product-view";

/** Primary image first, then by position. */
export function orderedImages(images: ProductImage[]): ProductImage[] {
  return [...images].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order);
}

export function toStorefrontImages(images: ProductImage[]): StorefrontImage[] {
  const store = imageStore();
  return orderedImages(images).map((i) => ({ url: store.publicUrl(i.storage_path), alt: i.alt_text }));
}

/** Images grouped by product id (one query for a whole list). */
export async function imagesByProduct(productIds: string[]): Promise<Map<string, ProductImage[]>> {
  const map = new Map<string, ProductImage[]>();
  for (const image of await commerceRepo().listProductImages(productIds)) {
    map.set(image.product_id, [...(map.get(image.product_id) ?? []), image]);
  }
  return map;
}

/** Published products only: drafts, unpublished and archived products are never public. */
export async function publishedProducts(): Promise<Product[]> {
  return (await commerceRepo().listProducts()).filter(isStorefrontVisible);
}

export async function publishedProductBySlug(slug: string): Promise<Product | null> {
  return (await publishedProducts()).find((p) => p.slug === slug) ?? null;
}
