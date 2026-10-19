import { cookies } from "next/headers";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { formContext, RECEIPT_COOKIE } from "@/lib/forms/public";
import { isPublicId, receiptLink } from "@/lib/forms/service.ts";

// The confirmation screen's Download PDF: the http-only cookie set at submission is the credential (one hour, this
// browser only). Answers a redirect to a 60-second link to the PDF.
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const back = (msg: string) => Response.redirect(new URL(`/f/${id}/done?error=${encodeURIComponent(msg)}`, request.url), 303);
  if (!isPublicId(id)) return new Response("Not found", { status: 404 });
  const [subId, token] = ((await cookies()).get(RECEIPT_COOKIE)?.value ?? "").split(".");
  try {
    const ctx = await formContext(id);
    if (!ctx?.pf || !subId) return back("This download has expired.");
    const sub = await ctx.deps.repo.getSubmission(subId);
    if (!sub || sub.form_id !== ctx.pf.form.id) return back("This download has expired.");
    return Response.redirect(await receiptLink(ctx.deps, subId, token ?? null), 303);
  } catch (e) {
    if (!(e instanceof ValidationError)) console.error(`form receipt failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    return back(e instanceof ValidationError ? e.message : "The PDF is still being prepared. Try again in a minute.");
  }
}
