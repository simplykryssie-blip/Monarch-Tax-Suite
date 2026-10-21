import type { Metadata } from "next";
import { PLATFORM, PLATFORM_DOMAIN } from "./platform-brand.ts";

// What link previews (Facebook, LinkedIn, X, iMessage) and browser tabs show for the site. The image files live in
// public/; previews need absolute URLs, so they're built on the app's public address.

export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || `https://${PLATFORM_DOMAIN}`).replace(/\/$/, "");
export const SITE_NAME = PLATFORM.name;
export const OG_IMAGE = PLATFORM.ogImage;

/** How a tenant's own pages (its storefront) introduce themselves in a link preview. Monarch Tax Suite, tenant #1, keeps its look. */
export type ShareBrand = { siteName: string; image: { url: string; width: number; height: number; alt: string } };
export const MONARCH_SHARE_BRAND: ShareBrand = { siteName: "Monarch Tax Suite", image: { url: "/monarch-og-image.jpg", width: 1200, height: 630, alt: "Monarch Tax Suite" } };

/** Open Graph and Twitter card fields for one page. A page that sets openGraph replaces the site's, so always use this. */
export function shareMeta(input: { title: string; description?: string; path: string; brand?: ShareBrand }): Pick<Metadata, "openGraph" | "twitter"> {
  const siteName = input.brand?.siteName ?? SITE_NAME;
  const image = input.brand?.image ?? OG_IMAGE;
  return {
    openGraph: { type: "website", siteName, title: input.title, description: input.description, url: input.path, images: [image] },
    twitter: { card: "summary_large_image", title: input.title, description: input.description, images: [image.url] },
  };
}
