import { NextResponse, type NextRequest } from "next/server";
import { classifyCallback } from "@/lib/crm/callback.ts";
import { completeConnection, startPendingInstall } from "@/lib/crm/connection.ts";
import { HighLevelError } from "@/lib/crm/highlevel.ts";
import { crmDeps, OAUTH_COOKIE, oauthCookieOptions, oauthRedirectUri, PENDING_COOKIE, pendingCookieOptions } from "@/lib/crm/server";
import { ValidationError } from "@/lib/commerce/validation.ts";

// HighLevel redirects here after the buyer approves access and picks a sub-account.
//  - Started from our setup page: the license comes only from the single-use state, which must also match this browser's cookie.
//  - Started inside HighLevel (no matching state): keep the approval in a short-lived encrypted cookie and ask for the license key.
export async function GET(request: NextRequest) {
  // GoHighLevel may only allow the legacy Vercel callback URL while the Marketplace
  // app is in review. The setup wizard, however, starts on app.monarchtaxsuite.com
  // and stores the one-time OAuth state in that host's HttpOnly cookie. Relay the
  // callback to the configured public host before reading cookies; keep the
  // original registered redirect URI for the later token exchange.
  const canonicalOrigin = (process.env.NEXT_PUBLIC_APP_URL || "https://monarch-tax-suite.vercel.app").replace(/\\/$/, "");
  if (request.nextUrl.origin !== canonicalOrigin) {
    const canonicalCallback = new URL(request.nextUrl.pathname + request.nextUrl.search, canonicalOrigin);
    const response = NextResponse.redirect(canonicalCallback, 307);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  const finish = (key: "notice" | "error", message: string, cookies?: (r: NextResponse) => void) => {
    const response = NextResponse.redirect(new URL(`/integrations?${key}=${encodeURIComponent(message)}`, request.url));
    response.cookies.set(OAUTH_COOKIE, "", { ...oauthCookieOptions, maxAge: 0 });
    cookies?.(response);
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const action = classifyCallback({ error: params.get("error"), code, state, cookieState: request.cookies.get(OAUTH_COOKIE)?.value });
  if (action === "denied") return finish("error", "GoHighLevel access was not granted.");
  if (action === "invalid") return finish("error", "GoHighLevel did not send an approval. Start again from the setup page.");
  try {
    if (action === "verified") {
      const connection = await completeConnection(crmDeps(), { state: state!, code: code!, redirectUri: await oauthRedirectUri() });
      return finish("notice", `GoHighLevel connected to ${connection.location_name ?? connection.location_id}. Test the connection below, then turn on lead capture.`);
    }
    const pending = await startPendingInstall(crmDeps(), { code: code!, redirectUri: await oauthRedirectUri() });
    return finish("notice", "GoHighLevel approved access. Enter your Monarch license key below to finish connecting.", (r) => r.cookies.set(PENDING_COOKIE, pending.sealed, pendingCookieOptions));
  } catch (e) {
    if (e instanceof ValidationError) return finish("error", e.message);
    if (e instanceof HighLevelError) {
      console.error("HighLevel OAuth failed:", e.status, e.kind);
      return finish("error", "GoHighLevel did not complete the connection. Please try again.");
    }
    throw e;
  }
}
