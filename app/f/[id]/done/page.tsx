import type { Metadata } from "next";
import { cookies } from "next/headers";
import { formContext, RECEIPT_COOKIE, receiptValid } from "@/lib/forms/public";
import { isPublicId } from "@/lib/forms/service.ts";
import { formatInZone } from "@/lib/documents/signing.ts";
import { ThemedPage } from "@/components/forms/themed-page";
import { brandedTheme } from "@/lib/branding/brand.ts";
import { loadBrand } from "@/lib/branding/server";
import { DEFAULT_THEME } from "@/lib/forms/theme.ts";
import { RichMessage } from "@/components/forms/rich-message";

export const metadata: Metadata = { title: "Submitted", robots: { index: false, follow: false } };

/** The confirmation screen. Its Download PDF button works for an hour, in the browser that submitted. */
export default async function FormDonePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  const ctx = isPublicId(id) ? await formContext(id).catch(() => null) : null;
  const firm = ctx?.firmName ?? "";
  const brand = ctx ? await loadBrand(ctx.tenantId).catch(() => null) : null;
  const [subId, token] = ((await cookies()).get(RECEIPT_COOKIE)?.value ?? "").split(".");
  const sub = ctx && subId && /^[0-9a-f-]{36}$/.test(subId) ? await ctx.deps.repo.getSubmission(subId).catch(() => null) : null;
  const valid = receiptValid(sub, token, ctx?.pf?.form.id);
  return (
    <ThemedPage theme={brandedTheme(ctx?.pf?.settings.theme ?? DEFAULT_THEME, brand)} firm={firm} maxWidth={720}>
        {firm && <div className="monarch-eyebrow">{firm.toUpperCase()}</div>}
        <h1>{valid ? "Submitted" : "Thank you"}</h1>
        {valid ? (
          <>
            <RichMessage text={ctx!.pf!.settings.confirmation_message} />
            <p>Submission <b>#{sub.number}</b>, received {formatInZone(new Date(sub.submitted_at!), ctx!.profile?.time_zone ?? "America/New_York")}.{sub.is_test ? " (TEST)" : ""}</p>
            {error && <p className="monarch-alert is-error">{error.slice(0, 300)}</p>}
            <p><a className="monarch-primary" href={`/f/${id}/receipt`} style={{ display: "inline-block", textDecoration: "none" }}>Download PDF</a></p>
            <p className="monarch-muted">The PDF has your answers, files and signature. This button works for an hour, in this browser only. Keep the PDF somewhere safe: it contains personal information.</p>
          </>
        ) : (
          <p>Your submission was received. The download of your copy is no longer available on this page.</p>
        )}
    </ThemedPage>
  );
}
