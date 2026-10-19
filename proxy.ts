import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { frameAncestors, hostFromHeader } from "@/lib/commerce/embed.ts";
import { loadEmbedDecision } from "@/lib/embed-server";
import { classifyHost, cleanRequestHost } from "@/lib/sites/host.ts";
import { hostHasSite } from "@/lib/sites/server";

// On an office's website address only the website and the parts it embeds are served: its pages, booking pages, public
// forms and account images. Everything else (login, admin, APIs) belongs to the application's own address.
const SITE_PASSTHROUGH = ["/book/", "/f/", "/media/", "/t/", "/u/"];

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const hostKind = classifyHost(request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
  if (hostKind.kind === "app") {
    // The website renderer is reachable through a website address only (the proxy sets x-site-host itself). Outside
    // production, /s/<address>/… also shows a site on the deployment's own address so a Preview can be tested without DNS.
    if (path === "/s" || path.startsWith("/s/")) {
      const testHost = process.env.VERCEL_ENV === "production" ? null : cleanRequestHost(decodeURIComponent(/^\/s\/([^/]+)/.exec(path)?.[1] ?? ""));
      if (!testHost) return new NextResponse("Not found", { status: 404 });
      const headers = new Headers(request.headers);
      headers.set("x-site-host", testHost);
      headers.set("x-site-base", `/s/${testHost}`);
      return NextResponse.next({ request: { headers } });
    }
  } else if (hostKind.kind === "platform-subdomain" || (await hostHasSite(hostKind.host))) {
    if (SITE_PASSTHROUGH.some((p) => path.startsWith(p))) return updateSession(request);
    const host = cleanRequestHost(hostKind.host)!;
    const url = request.nextUrl.clone();
    url.pathname = `/s/${host}${path === "/" ? "" : path}`;
    const headers = new Headers(request.headers);
    headers.set("x-site-host", host);
    headers.set("x-site-base", "");
    return NextResponse.rewrite(url, { request: { headers } });
  }
  if (request.nextUrl.pathname.startsWith("/embed/")) {
    // Embeds have no admin session; the browser enforces where they may render.
    let policy = "frame-ancestors 'none'";
    try {
      policy = frameAncestors(await loadEmbedDecision(request.nextUrl.searchParams.get("id"), hostFromHeader(request.headers.get("referer"))));
    } catch {
      // Fail closed: if the license cannot be checked, nothing may frame it.
    }
    const response = NextResponse.next();
    response.headers.set("Content-Security-Policy", policy);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
