import { cookies } from "next/headers";
import { downloadUrl, planForBuyer } from "@/lib/wisp/service.ts";
import { requestTenant, wispDeps } from "@/lib/wisp/server";
import { WISP_COOKIE } from "@/lib/wisp/cookie.ts";

/** The buyer's download, from the browser that paid: a 60-second link to their PDF. */
export async function GET(request: Request) {
  const back = (msg: string) => Response.redirect(new URL(`/wisp/done?error=${encodeURIComponent(msg)}`, request.url), 303);
  try {
    const deps = wispDeps(await requestTenant());
    const [planId, token] = ((await cookies()).get(WISP_COOKIE)?.value ?? "").split(".");
    const plan = planId && token ? await planForBuyer(deps, planId, token) : null;
    if (!plan || plan.status === "draft") return back("We couldn't find a paid WISP in this browser. Use the link in your email.");
    return Response.redirect(await downloadUrl(deps, plan, "buyer"), 303);
  } catch (e) {
    console.error(`wisp download failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    return back("The download didn't start. Please try again in a minute.");
  }
}
