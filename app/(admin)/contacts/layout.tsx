import { requireSection } from "@/lib/tier-server";

// Contacts joins the lists of leads, clients and customers, so it opens for any account that has the workspace.
// Each source inside it is still left out when the account's plan doesn't include it (see lib/contacts/server.ts).
export default async function SectionLayout({ children }: { children: React.ReactNode }) {
  await requireSection("workspace");
  return <>{children}</>;
}
