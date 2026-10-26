import { requireSection } from "@/lib/tier-server";

export default async function PipelinesLayout({ children }: { children: React.ReactNode }) {
  await requireSection("workspace");
  return <>{children}</>;
}
