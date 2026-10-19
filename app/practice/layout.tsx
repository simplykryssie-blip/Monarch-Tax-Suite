import type { Metadata } from "next";

export const metadata: Metadata = { title: "Workspace | Verexa HQ", robots: { index: false, follow: false } };

export default function PracticeRoot({ children }: { children: React.ReactNode }) {
  return <div className="office-root">{children}</div>;
}
