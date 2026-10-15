import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hostFromHeaders, isPlatformHost } from "@/lib/brands.ts";
import { formLink } from "@/lib/forms/link";
import { FormRenderer } from "@/components/forms/form-renderer";
import { formContext } from "@/lib/forms/public";
import { ThemedPage } from "@/components/forms/themed-page";
import { DEFAULT_THEME, type FormTheme } from "@/lib/forms/theme.ts";
import { publicDefinition } from "@/lib/forms/definition.ts";
import { isPublicId, resumeDraft, startStamp } from "@/lib/forms/service.ts";
import { respondentKeys } from "@/lib/forms/settings.ts";

export const metadata: Metadata = { title: "Form", robots: { index: false, follow: false } };

const Shell = ({ firm, theme = DEFAULT_THEME, children }: { firm?: string; theme?: FormTheme; children: React.ReactNode }) => (
  <ThemedPage theme={theme} firm={firm}>
    {firm && <div className="monarch-eyebrow">{firm.toUpperCase()}</div>}
    {children}
  </ThemedPage>
);

/** A firm's public form. No login: the link is public, and every action is limited and checked on the server. */
export default async function PublicFormPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ resume?: string }> }) {
  const { id } = await params;
  const { resume } = await searchParams;
  const ctx = isPublicId(id) ? await formContext(id).catch(() => null) : null;
  const firm = ctx?.firmName ?? "";
  if (!ctx?.pf) return <Shell firm={firm}><p>This form link is not valid. Check that you copied the whole address.</p></Shell>;
  const { pf } = ctx;
  // A form opened on a hosting-platform address (*.vercel.app) is sent to the office's own web address.
  if (process.env.VERCEL_ENV === "production" && isPlatformHost(hostFromHeaders(await headers()))) {
    const own = await formLink(ctx.deps, id, pf.settings).catch(() => null);
    if (own && !isPlatformHost(new URL(own).host)) redirect(`${own}${resume ? `?resume=${encodeURIComponent(resume)}` : ""}`);
  }
  if (pf.state !== "open") return <Shell firm={firm} theme={pf.settings.theme}><h1>{pf.form.name}</h1><p style={{ whiteSpace: "pre-wrap" }}>{pf.settings.closed_message}</p></Shell>;
  const resumed = resume ? await resumeDraft(ctx.deps, pf, resume) : null;
  return (
    <ThemedPage theme={pf.settings.theme} firm={firm}>
        {resume && !resumed && <p className="monarch-alert is-error">That saved-form link has expired or was already used. You can start the form again below.</p>}
        {resumed && <p className="monarch-notice"><b>WELCOME BACK</b> Your saved answers and files are filled in. Check them, then continue.</p>}
        <FormRenderer
          mode="live"
          publicId={pf.form.public_id}
          definition={publicDefinition(pf.version.definition)}
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
    </ThemedPage>
  );
}
