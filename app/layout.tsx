import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource/playfair-display/600.css";
import "@fontsource/playfair-display/700.css";
import "./globals.css";
import "./theme.css";
export const metadata: Metadata = { title: "Monarch Tax Suite | Admin Workspace", description: "The Monarch Tax Suite internal operations platform." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inside the pop-up (an iframe of this site) hide the app chrome before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: 'try{if(window.self!==window.top)document.documentElement.setAttribute("data-popup","1")}catch(e){document.documentElement.setAttribute("data-popup","1")}' }} />
      </head>
      <body>{children}</body>
    </html>
  ); }
