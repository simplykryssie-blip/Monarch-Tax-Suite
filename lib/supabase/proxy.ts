import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";
import { LEGAL_PAGES_APPROVED, LEGAL_PATHS } from "../legal.ts";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabaseConfigProblems } from "./config";

// The Stripe webhook authenticates by signature, not session. /shop lists
// published products only. /integrations authorizes each action with the buyer's license key; the
// lead endpoint authorizes with a signed embed token.
const PUBLIC_PATHS: string[] = ["/login", "/basic-calculator", "/api/stripe/webhook", "/api/license/", "/install/", "/update", "/shop", "/integrations", "/api/integrations/crm/", "/api/leads",
  // The draft legal pages are public only after the owner and counsel approve them (lib/legal.ts).
  ...(LEGAL_PAGES_APPROVED ? LEGAL_PATHS : []),
];

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
      `<p>Monarch Tax Suite cannot start because its database settings are missing or unsafe for this environment.</p><ul>${items}</ul>` +
      `<p style="color:#69665d;font-size:13px">Set the variables for this environment in the Vercel project settings and redeploy.</p></body></html>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

export async function updateSession(request: NextRequest) {
  const problems = supabaseConfigProblems(process.env);
  if (problems.length) return configurationErrorResponse(problems);
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
  );

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
