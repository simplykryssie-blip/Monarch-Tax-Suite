import type { Metadata } from "next";

// What link previews (Facebook, LinkedIn, X, iMessage) and browser tabs show for the site. The image files live in
// public/; previews need absolute URLs, so they're built on the app's public address.

export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.monarchtaxsuite.com").replace(/\/$/, "");
export const SITE_NAME = "Monarch Tax Suite";
export const OG_IMAGE = { url: "/monarch-og-image.jpg", width: 1200, height: 630, alt: "Monarch Tax Suite" };

/** Open Graph and Twitter card fields for one page. A page that sets openGraph replaces the site's, so always use this. */
export function shareMeta(input: { title: string; description?: string; path: string }): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: { type: "website", siteName: SITE_NAME, title: input.title, description: input.description, url: input.path, images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title: input.title, description: input.description, images: [OG_IMAGE.url] },
  };
}
