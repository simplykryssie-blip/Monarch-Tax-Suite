import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";
import { LEGAL_PAGES_APPROVED, LEGAL_PATHS } from "../legal.ts";
import { PLATFORM_LEGAL_APPROVED, PLATFORM_LEGAL_PATHS } from "../platform-legal.ts";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabaseConfigProblems } from "./config";

// The Stripe webhook authenticates by signature, not session. /shop lists
// published products only. /integrations authorizes each action with the buyer's license key; the
// lead endpoint authorizes with a signed embed token.
const PUBLIC_PATHS: string[] = ["/login", "/basic-calculator", "/api/stripe/webhook", "/api/stripe/connect-webhook", "/api/stripe/billing-webhook", "/api/license/", "/install/", "/update", "/shop", "/integrations", "/api/integrations/crm/", "/api/leads",
  // Customer setup links (the token is the credential) and the retry runner (authorized by CRON_SECRET).
  "/setup", "/api/automation/run", "/api/automation/tick",
  // Buyer downloads: every file request is authorized by the buyer's license key and checked again on each click.
  "/downloads",
  // Secure document links sent by a firm: the link token is the credential, checked again on every request.
  "/d/", "/sign/",
  // Self-serve signup: public, with an email check, a bot check and rate limits; the payment page is Stripe's.
  "/signup",
  // Campaign emails and texts: the per-recipient link token is the credential (open pixel, click redirect, unsubscribe), and the
  // provider callbacks (Resend, Twilio) authenticate themselves.
  "/t/", "/u/", "/api/campaigns/", "/api/sms/",
  // Public forms: anyone with the link may fill them in; every action is limited per visitor and checked again on the server.
  "/f/",
  // Public booking pages and the emailed manage links: the web address names the office, the link token is the credential.
  "/book/",
  // Account images shown in emails, public forms and the shop: image files only, read from that tenant's own bucket.
  "/media/",
  // The WISP Generator: public audit and builder; downloads need the buying browser's secret or the emailed link token.
  "/wisp",
  // Office invites: the one-time link token is the credential. The rest of /office requires sign-in and two-step sign-in.
  "/office/invite/", "/practice/invite/", "/portal/invite/",
  // Password reset: the email link lands on /auth/callback; /reset-password checks for the session itself.
  "/forgot-password", "/reset-password", "/auth/",
  // The draft legal pages are public only after the owner and counsel approve them (lib/legal.ts).
  ...(LEGAL_PAGES_APPROVED ? LEGAL_PATHS : []),
  // Verexa HQ's own policies: public only once the owner approves final wording (lib/platform-legal.ts).
  ...(PLATFORM_LEGAL_APPROVED ? PLATFORM_LEGAL_PATHS : []),
];

// Pages that are public at exactly this path (their sub-pages are listed above with a trailing slash). The booking index is the
// front door of a booking address (book.<firm domain>) and the "all appointment types" link, so it must open without signing in.
const PUBLIC_EXACT: string[] = ["/book"];

/**
 * A deployment without its database settings cannot authenticate anyone, so
 * every route (public ones included) gets an explicit 503 instead of a crash.
 * The page names the missing variables, never their values. Nothing is
 * served and no authentication is skipped.
 */
function configurationErrorResponse(problems: string[]) {
  console.error(`supabase-config: deployment is not configured: ${problems.join(" ")}`);
  const items = problems.map((p) => `<li>${p.replace(/[<>&]/g, "")}</li>`).join("");
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Configuration required</title></head>` +
      `<body style="font-family:Arial,sans-serif;max-width:640px;margin:60px auto;padding:0 16px;color:#211f19">` +
      `<h1 style="font-size:22px">This deployment is not configured</h1>` +
      `<p>Verexa HQ cannot start because its database settings are missing or unsafe for this environment.</p><ul>${items}</ul>` +
      `<p style="color:#69665d;font-size:13px">Set the variables for this environment in the Vercel project settings and redeploy.</p></body></html>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

export async function updateSession(request: NextRequest) {
  const problems = supabaseConfigProblems(process.env);
  if (problems.length) return configurationErrorResponse(problems);
  // Server code (the workspace's billing gate) needs to know which page and method a request is for. Set here, always
  // overwriting anything the browser sent.
  request.headers.set("x-pathname", request.nextUrl.pathname);
  request.headers.set("x-method", request.method);
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  ) || PUBLIC_EXACT.includes(request.nextUrl.pathname);

  if (!user && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Signed-in users skip the login page unless it is showing an access error
  // (e.g. a non-administrator account), which would otherwise loop.
  if (user && request.nextUrl.pathname === "/login" && !request.nextUrl.searchParams.has("error")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}
