import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { formDeps } from "@/lib/forms/server";
import { startStamp } from "@/lib/forms/service.ts";
import { FormRenderer } from "@/components/forms/form-renderer";
import { publicDefinition } from "@/lib/forms/definition.ts";
import { testSubmitAction } from "../../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** "Test the published form": a real submission of the published version, marked TEST. */
export default async function FormTestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const deps = formDeps();
  const form = await deps.repo.getForm(id);
  const version = form?.current_version_id ? await deps.repo.getVersion(form.current_version_id) : null;
  if (!form || !version) notFound();
  const profile = await deps.profile();
  const submit = testSubmitAction.bind(null, form.id);
  return (
    <div style={{ padding: "16px 0" }}>
      <div className="monarch-public-card" style={{ maxWidth: 820, margin: "0 auto" }}>
        <FormRenderer mode="test" publicId={form.public_id} definition={publicDefinition(version.definition)} formName={form.name} description={form.description} firmName={profile?.display_name ?? "Your firm"}
          consentText={form.signature_consent} allowSaveLater={false} respondentEmailKey={null} stamp={startStamp(deps, form.id)} testSubmit={submit} />
      </div>
    </div>
  );
}
