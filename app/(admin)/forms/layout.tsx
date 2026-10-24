import { requireSection } from "@/lib/tier-server";

// Only accounts whose tier includes this section can open it (see lib/tier.ts).
export default async function SectionLayout({ children }: { children: React.ReactNode }) {
  await requireSection("workspace");
  return <>{children}</>;
}
