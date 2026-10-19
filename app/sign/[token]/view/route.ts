import { linkContext } from "@/lib/documents/public";
import { fileLink } from "@/lib/documents/service.ts";

// Shows the PDF waiting to be signed (or, once signed, the signed copy) through a 60-second link. Checked on every
// request: an expired, revoked or closed request shows nothing.

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await linkContext(token).catch(() => null);
  if (!ctx || !ctx.state.ok || !ctx.state.signature) return new Response("Not available", { status: 404 });
  const { delivery, signature } = ctx.state;
  const path = signature.status === "signed" ? signature.signed_storage_path : signature.status === "sent" || signature.status === "viewed" ? delivery.storage_path : null;
  if (!path) return new Response("Not available", { status: 404 });
  return Response.redirect(await fileLink(ctx.deps, path, null), 302);
}
