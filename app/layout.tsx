import type { Metadata } from "next";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/700.css";
import "./globals.css";
import "./theme.css";
export const metadata: Metadata = { title: "Monarch Tax Suite | Admin Workspace", description: "The Monarch Tax Suite internal operations platform." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
