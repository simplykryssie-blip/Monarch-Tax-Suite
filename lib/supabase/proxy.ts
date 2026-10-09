import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

// The Stripe webhook authenticates by signature, not session. /shop lists
// published products only. /portal authenticates buyers by license key; the
// lead and cron endpoints authorize themselves (signed embed token / CRON_SECRET).
const PUBLIC_PATHS = ["/login", "/basic-calculator", "/api/stripe/webhook", "/api/license/", "/install/", "/update", "/shop", "/portal", "/api/integrations/crm/", "/api/leads", "/api/cron/"];

export async function updateSession(request: NextRequest) {
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
