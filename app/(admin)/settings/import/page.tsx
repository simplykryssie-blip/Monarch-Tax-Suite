import { PageTitle } from "@/components/admin/ui";
import { ImportPanel } from "@/components/imports/import-panel";
import { requireSection } from "@/lib/tier-server";
import { allows } from "@/lib/tier.ts";
import type { Destination } from "@/lib/imports/contacts.ts";

/** Import people, notes and messages from GoHighLevel or any spreadsheet, into the places this account's tier has. */
export default async function ImportPage() {
  const { tier } = await requireSection("settings");
  const destinations: Destination[] = [
    "clients",
    ...(allows(tier, "leads") ? (["leads"] as const) : []),
    ...(allows(tier, "store") ? (["customers"] as const) : []),
    ...(allows(tier, "bureau") ? (["firms"] as const) : []),
  ];
  return (
    <>
      <PageTitle title="Import data">Bring your people, notes and messages in from GoHighLevel or a spreadsheet. You always see a preview first, and nothing is saved until you confirm.</PageTitle>
      <ImportPanel scope="admin" destinations={destinations} />
    </>
  );
}
