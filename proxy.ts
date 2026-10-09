import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { frameAncestors, hostFromHeader } from "@/lib/commerce/embed.ts";
import { loadEmbedDecision } from "@/lib/embed-server";

export async function proxy(request: NextRequest) {
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
