import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { completeConnection } from "@/lib/crm/connection.ts";
import { HighLevelError } from "@/lib/crm/highlevel.ts";
import { crmDeps, OAUTH_COOKIE, oauthCookieOptions, oauthRedirectUri } from "@/lib/crm/server";
import { ValidationError } from "@/lib/commerce/validation.ts";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// HighLevel redirects here after the buyer approves access and picks a sub-account.
// The license comes only from the single-use state, which must also match this browser's cookie.
export async function GET(request: NextRequest) {
  const finish = (key: "notice" | "error", message: string) => {
    const response = NextResponse.redirect(new URL(`/integrations?${key}=${encodeURIComponent(message)}`, request.url));
    response.cookies.set(OAUTH_COOKIE, "", { ...oauthCookieOptions, maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
  const params = request.nextUrl.searchParams;
  if (params.get("error")) return finish("error", "GoHighLevel access was not granted.");
  const code = params.get("code");
  const state = params.get("state");
  const cookieState = request.cookies.get(OAUTH_COOKIE)?.value;
  if (!code || !state || !cookieState || !same(state, cookieState)) {
    return finish("error", "This connection attempt could not be verified. Start again from the setup page in the same browser.");
  }
  try {
    const connection = await completeConnection(crmDeps(), { state, code, redirectUri: await oauthRedirectUri() });
    return finish("notice", `GoHighLevel connected to ${connection.location_name ?? connection.location_id}. Turn on the lead form below if you have not already.`);
  } catch (e) {
    if (e instanceof ValidationError) return finish("error", e.message);
    if (e instanceof HighLevelError) {
      console.error("HighLevel OAuth failed:", e.status, e.kind);
      return finish("error", "GoHighLevel did not complete the connection. Please try again.");
    }
    throw e;
  }
}
