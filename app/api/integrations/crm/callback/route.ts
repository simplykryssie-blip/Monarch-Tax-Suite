import { timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { completeConnection } from "@/lib/crm/connection.ts";
import { HighLevelError } from "@/lib/crm/highlevel.ts";
import { processDueLeads } from "@/lib/crm/leads.ts";
import { crmDeps, OAUTH_COOKIE, oauthRedirectUri, portalLicense } from "@/lib/crm/server";
import { ValidationError } from "@/lib/commerce/validation.ts";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// HighLevel redirects here after the buyer approves access and picks a sub-account.
export async function GET(request: NextRequest) {
  const finish = (key: "notice" | "error", message: string) => {
    const response = NextResponse.redirect(new URL(`/portal?${key}=${encodeURIComponent(message)}`, request.url));
    response.cookies.delete({ name: OAUTH_COOKIE, path: "/api/integrations/crm" });
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
  const params = request.nextUrl.searchParams;
  if (params.get("error")) return finish("error", "GoHighLevel access was not granted.");
  const code = params.get("code");
  const state = params.get("state");
  const cookieState = request.cookies.get(OAUTH_COOKIE)?.value;
  if (!code || !state || !cookieState || !same(state, cookieState)) {
    return finish("error", "This connection attempt could not be verified. Start again from your portal.");
  }
  const license = await portalLicense();
  if (!license) return finish("error", "Your portal session expired. Sign in and connect again.");
  const deps = crmDeps();
  try {
    const connection = await completeConnection(deps, { licenseId: license.id, state, code, redirectUri: await oauthRedirectUri() });
    after(() => processDueLeads(deps, { licenseId: license.id, limit: 25 }));
    return finish("notice", `GoHighLevel connected to ${connection.location_name ?? connection.location_id}. Run "Test connection", then turn on lead capture.`);
  } catch (e) {
    if (e instanceof ValidationError) return finish("error", e.message);
    if (e instanceof HighLevelError) {
      console.error("HighLevel OAuth failed:", e.status, e.kind);
      return finish("error", "GoHighLevel did not complete the connection. Please try again.");
    }
    throw e;
  }
}
