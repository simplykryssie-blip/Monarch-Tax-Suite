import { downloadUrl, planForLink } from "@/lib/wisp/service.ts";
import { requestTenant, wispDeps } from "@/lib/wisp/server";

/** The download link in the delivery email: works for a year, and each download is logged. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const page = (msg: string) => new Response(`<!doctype html><meta name="viewport" content="width=device-width"><title>WISP download</title><body style="font-family:system-ui;background:#000;color:#fff;padding:32px"><p>${msg}</p></body>`, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  try {
    const deps = wispDeps(await requestTenant());
    const plan = await planForLink(deps, token);
    if (!plan) return page("This download link has expired or isn't valid. Reply to your WISP email and we'll send a new one.");
    return Response.redirect(await downloadUrl(deps, plan, "buyer"), 303);
  } catch (e) {
    console.error(`wisp link download failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    return page("The download didn't start. Please try again in a minute.");
  }
}
