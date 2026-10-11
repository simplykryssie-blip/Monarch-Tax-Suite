import { requireAdmin } from "@/lib/admin";
import { Flash, PageTitle } from "@/components/admin/ui";
import { OnboardingWizard } from "../onboarding";

export default async function AddEro({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  return (
    <>
      <PageTitle title="Add a firm" back={{ href: "/efin/list", label: "Firms" }}>Five short steps. Sensitive numbers are encrypted when saved, and only the last four digits stay readable.</PageTitle>
      <Flash {...await searchParams} />
      <OnboardingWizard />
    </>
  );
}
