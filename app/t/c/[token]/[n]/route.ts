import { clickTarget } from "@/lib/campaigns/public";

// A link in a campaign email: counts the click and sends the reader on to the address the office wrote.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string; n: string }> }) {
  const { token, n } = await params;
  const target = await clickTarget(token, Number(n));
  if (!target) return new Response("This link is no longer available.", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
