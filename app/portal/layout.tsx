import type { Metadata } from "next";

export const metadata: Metadata = { title: "Client portal", robots: { index: false, follow: false } };

export default function PortalRoot({ children }: { children: React.ReactNode }) {
  return <div className="office-root">{children}</div>;
}
