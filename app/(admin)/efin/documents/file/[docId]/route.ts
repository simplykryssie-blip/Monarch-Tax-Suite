import { requireAdmin } from "@/lib/admin";
import { documentLink } from "@/lib/efin/service";

// Redirects to a 60-second signed link for one document, after recording the download. Administrators only.
export async function GET(_request: Request, { params }: { params: Promise<{ docId: string }> }) {
  const session = await requireAdmin();
  const { docId } = await params;
  try {
    const url = await documentLink({ id: session.userId, email: session.email }, docId);
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch {
    return new Response("That document is not available.", { status: 404 });
  }
}
