import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource/playfair-display/600.css";
import "@fontsource/playfair-display/700.css";
import "./globals.css";
import "./theme.css";
import { SITE_URL } from "@/lib/site-meta";
import { PLATFORM } from "@/lib/platform-brand";
export const metadata: Metadata = {
  title: { default: `${PLATFORM.name} | Admin Workspace`, template: `%s | ${PLATFORM.name}` },
  description: PLATFORM.description,
  metadataBase: new URL(SITE_URL),
  icons: { icon: [{ url: PLATFORM.favicon, sizes: "32x32", type: "image/png" }], apple: PLATFORM.appleIcon },
  openGraph: { type: "website", siteName: PLATFORM.name, images: [PLATFORM.ogImage] },
  twitter: { card: "summary_large_image", images: [PLATFORM.ogImage.url] },
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
