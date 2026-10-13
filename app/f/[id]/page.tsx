import type { Metadata } from "next";
import { FormRenderer } from "@/components/forms/form-renderer";
import { formContext } from "@/lib/forms/public";
import { isPublicId, resumeDraft, startStamp } from "@/lib/forms/service.ts";
import { respondentKeys } from "@/lib/forms/settings.ts";

export const metadata: Metadata = { title: "Form", robots: { index: false, follow: false } };

const Shell = ({ firm, children }: { firm?: string; children: React.ReactNode }) => (
  <main className="monarch-public">
    <div className="monarch-public-card" style={{ maxWidth: 820 }}>
      {firm && <div className="monarch-eyebrow">{firm.toUpperCase()}</div>}
      {children}
    </div>
  </main>
);

/** A firm's public form. No login: the link is public, and every action is limited and checked on the server. */
export default async function PublicFormPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ resume?: string }> }) {
  const { id } = await params;
  const { resume } = await searchParams;
  const ctx = isPublicId(id) ? await formContext(id).catch(() => null) : null;
  const firm = ctx?.profile?.display_name ?? "";
  if (!ctx?.pf) return <Shell firm={firm}><p>This form link is not valid. Check that you copied the whole address.</p></Shell>;
  const { pf } = ctx;
  if (pf.state !== "open") return <Shell firm={firm}><h1>{pf.form.name}</h1><p style={{ whiteSpace: "pre-wrap" }}>{pf.settings.closed_message}</p></Shell>;
  const resumed = resume ? await resumeDraft(ctx.deps, pf, resume) : null;
  return (
    <main className="monarch-public">
      <div className="monarch-public-card" style={{ maxWidth: 820 }}>
        {resume && !resumed && <p className="monarch-alert is-error">That saved-form link has expired or was already used. You can start the form again below.</p>}
        {resumed && <p className="monarch-notice"><b>WELCOME BACK</b> Your saved answers and files are filled in. Check them, then continue.</p>}
        <FormRenderer
          mode="live"
          publicId={pf.form.public_id}
          definition={pf.version.definition}
          formName={pf.form.name}
          description={pf.form.description}
          firmName={firm || "Tax office"}
          consentText={pf.form.signature_consent}
          allowSaveLater={pf.settings.allow_save_later}
          respondentEmailKey={respondentKeys(pf.settings, pf.version.definition).email_key}
          stamp={startStamp(ctx.deps, pf.form.id)}
          initialAnswers={resumed?.answers}
          initialToken={resumed?.token ?? null}
        />
      </div>
    </main>
  );
}
