import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { formLink } from "@/lib/forms/link";
import { formDeps } from "@/lib/forms/server";
import { brandFor } from "@/lib/forms/service.ts";
import { readSettings } from "@/lib/forms/settings.ts";
import { emptyDefinition, type FormDefinition } from "@/lib/forms/definition.ts";
import { Flash, PageTitle } from "@/components/admin/ui";
import { FormBuilder } from "@/components/forms/form-builder";
import { FormTabs, formsLoad, FormsSetupRequired } from "@/components/forms/admin-bits";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function FormBuildPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { notice, error } = await searchParams;
  if (!UUID.test(id)) notFound();
  const result = await formsLoad(async () => {
    const deps = formDeps();
    const form = await deps.repo.getForm(id);
    if (!form) return null;
    const version = form.current_version_id ? await deps.repo.getVersion(form.current_version_id) : null;
    const settings = readSettings(form.settings);
    const [brand, link] = await Promise.all([brandFor(deps, settings), formLink(deps, form.public_id, settings)]);
    return { form, version, brand, link };
  });
  if (!result.ok) return <FormsSetupRequired message={result.message} />;
  if (!result.data) notFound();
  const { form, version, brand, link } = result.data;
  const draft = (form.draft_definition && Array.isArray((form.draft_definition as FormDefinition).pages) && (form.draft_definition as FormDefinition).pages.length ? form.draft_definition : emptyDefinition()) as FormDefinition;
  return (
    <>
      <PageTitle title={form.name} back={{ href: "/forms", label: "Forms" }}>{brand ? `Firm: ${brand.name}. ` : ""}{version ? `Published version ${version.version}.` : "Not published yet."} Drag questions onto the page; the draft saves as you go.</PageTitle>
      <Flash notice={notice} error={error} />
      <FormTabs form={form} active="build" />
      <FormBuilder
        formId={form.id}
        initial={draft}
        savedAt={form.draft_updated_at}
        canPublish={form.status !== "archived"}
        publishedVersion={version?.version ?? null}
        publicUrl={version && form.status === "published" ? link : null}
      />
    </>
  );
}
