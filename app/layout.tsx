import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Monarch Tax Suite | Admin Workspace", description: "The Monarch Tax Suite internal operations platform." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
