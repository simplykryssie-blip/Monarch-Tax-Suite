import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { formDeps } from "@/lib/forms/server";
import { ThemedPage } from "@/components/forms/themed-page";
import { brandedTheme } from "@/lib/branding/brand.ts";
import { loadBrand } from "@/lib/branding/server";
import { FormRenderer } from "@/components/forms/form-renderer";
import { emptyDefinition, publicDefinition, type FormDefinition } from "@/lib/forms/definition.ts";
import { readSettings } from "@/lib/forms/settings.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The draft as respondents would see it, at computer or phone width. Nothing can be submitted. */
export default async function FormPreviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ width?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { width } = await searchParams;
  if (!UUID.test(id)) notFound();
  const deps = formDeps();
  const form = await deps.repo.getForm(id);
  if (!form) notFound();
  const profile = await deps.profile();
  const brand = await loadBrand();
  const def = (Array.isArray((form.draft_definition as FormDefinition).pages) ? form.draft_definition : emptyDefinition()) as FormDefinition;
  const phone = width === "phone";
  return (
    <div style={{ padding: "16px 0" }}>
      <p className="monarch-inline-actions" style={{ justifyContent: "center", display: "flex", gap: 12 }}>
        <a className={phone ? "monarch-secondary" : "monarch-primary"} href={`/forms/${id}/preview`}>Computer width</a>
        <a className={phone ? "monarch-primary" : "monarch-secondary"} href={`/forms/${id}/preview?width=phone`}>Phone width</a>
      </p>
      <ThemedPage theme={brandedTheme(readSettings(form.settings).theme, brand)} firm={profile?.display_name ?? "Your firm"} maxWidth={phone ? 390 : 820} wrapper="div">
        <FormRenderer mode="preview" publicId={form.public_id} definition={publicDefinition(def)} formName={form.name} description={form.description} firmName={profile?.display_name ?? "Your firm"}
          consentText={form.signature_consent} allowSaveLater={false} respondentEmailKey={null} stamp="" />
      </ThemedPage>
      <p className="monarch-muted" style={{ textAlign: "center" }}>Show/hide and skip logic work here as they will for respondents. {readSettings(form.settings).allow_save_later ? "Save and continue later is on." : ""}</p>
    </div>
  );
}
