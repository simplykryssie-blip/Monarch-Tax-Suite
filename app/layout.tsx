import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource/playfair-display/600.css";
import "@fontsource/playfair-display/700.css";
import "./globals.css";
import "./theme.css";
import { OG_IMAGE, SITE_NAME, SITE_URL } from "@/lib/site-meta";
export const metadata: Metadata = {
  title: "Monarch Tax Suite | Admin Workspace",
  description: "The Monarch Tax Suite internal operations platform.",
  metadataBase: new URL(SITE_URL),
  icons: { icon: [{ url: "/monarch-favicon-32.png", sizes: "32x32", type: "image/png" }], apple: "/monarch-apple-touch-icon.png" },
  openGraph: { type: "website", siteName: SITE_NAME, images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", images: [OG_IMAGE.url] },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inside the pop-up (an iframe of this site) hide the app chrome before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: 'try{if(window.self!==window.top)document.documentElement.setAttribute("data-popup","1")}catch(e){document.documentElement.setAttribute("data-popup","1")}' }} />
      </head>
      <body>{children}</body>
    </html>
  ); }
