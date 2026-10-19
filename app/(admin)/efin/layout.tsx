import { requireSection } from "@/lib/tier-server";

// My Service Bureau belongs to the Service Bureau tier (see lib/tier.ts).
export default async function EfinLayout({ children }: { children: React.ReactNode }) {
  await requireSection("bureau");
  return <>{children}</>;
}
