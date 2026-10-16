import type { Metadata } from "next";

export const metadata: Metadata = { title: "Office | Verexa HQ", robots: { index: false, follow: false } };

export default function OfficeRoot({ children }: { children: React.ReactNode }) {
  return <div className="office-root">{children}</div>;
}
