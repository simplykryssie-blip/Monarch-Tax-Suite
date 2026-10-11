import { requireAdmin } from "@/lib/admin";
import { Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { loadSnapshot } from "@/lib/efin/service";
import { OnboardingWizard } from "../onboarding";

export default async function AddFirm({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const result = await load(loadSnapshot);
  return (
    <>
      <PageTitle title="Add a firm" back={{ href: "/efin/list", label: "Firms" }}>Six short steps. Sensitive numbers are encrypted when saved, and only the last four digits stay readable.</PageTitle>
      <Flash {...await searchParams} />
      {!result.ok ? <SetupRequired message={result.message} module="efin" /> : <OnboardingWizard options={result.data.options.filter((o) => o.active).map((o) => ({ id: o.id, kind: o.kind, name: o.name }))} />}
    </>
  );
}
