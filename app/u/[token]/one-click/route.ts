import { unsubscribeByToken } from "@/lib/campaigns/public";

// The unsubscribe button on the page, and the one-click unsubscribe mail apps send (RFC 8058: a POST). Both stop campaign
// email from this office to the address, and nothing else.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const done = await unsubscribeByToken(token).catch(() => null);
  if (!done) return new Response("This unsubscribe link isn't valid.", { status: 404 });
  const wantsPage = (request.headers.get("content-type") ?? "").includes("form-urlencoded") && !(await request.text()).includes("One-Click");
  if (wantsPage) return new Response(null, { status: 303, headers: { Location: `/u/${token}?done=1` } });
  return new Response("Unsubscribed", { status: 200 });
}
