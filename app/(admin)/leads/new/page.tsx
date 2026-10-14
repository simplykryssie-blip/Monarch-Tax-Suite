import { requireAdmin } from "@/lib/admin";
import { PageTitle } from "@/components/admin/ui";
import { leadsDeps } from "@/lib/leads/server";
import { NewLeadForm } from "./new-lead-form";

export default async function NewLeadPage() {
  await requireAdmin();
  const tagOptions = await leadsDeps().repo.tagCounts().then((t) => t.map((x) => x.tag)).catch(() => []);
  return (
    <>
      <PageTitle title="Add lead" back={{ href: "/leads", label: "Leads" }}>Someone you met in a Facebook group, a referral, or anyone else. Name and email are required; one email is one lead.</PageTitle>
      <NewLeadForm tagOptions={tagOptions} />
    </>
  );
}
