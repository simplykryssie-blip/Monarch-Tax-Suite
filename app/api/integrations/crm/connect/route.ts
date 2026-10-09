import { NextResponse, type NextRequest } from "next/server";
import { startConnection } from "@/lib/crm/connection.ts";
import { authorizeUrl } from "@/lib/crm/highlevel.ts";
import { cookieOptions, crmDeps, OAUTH_COOKIE, oauthRedirectUri, portalLicense } from "@/lib/crm/server";
import { ValidationError } from "@/lib/commerce/validation.ts";

// Starts the HighLevel OAuth flow for the license in the buyer's portal session.
export async function GET(request: NextRequest) {
  const back = (key: "error", message: string) => NextResponse.redirect(new URL(`/portal?${key}=${encodeURIComponent(message)}`, request.url));
  const license = await portalLicense();
  if (!license) return back("error", "Sign in with your license key first.");
  const clientId = process.env.HIGHLEVEL_CLIENT_ID;
  try {
    const state = await startConnection(crmDeps(), license.id);
    const response = NextResponse.redirect(authorizeUrl(clientId!, await oauthRedirectUri(), state));
    // Binds the flow to this browser; the callback must present the same value.
    response.cookies.set(OAUTH_COOKIE, state, cookieOptions(600, "/api/integrations/crm"));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (e) {
    if (e instanceof ValidationError) return back("error", e.message);
    throw e;
  }
}
