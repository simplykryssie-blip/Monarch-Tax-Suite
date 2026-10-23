import { NextResponse, type NextRequest } from "next/server";
import { callbackFailureMessage, RESET_LINK_INVALID } from "@/lib/auth-links.ts";
import { createClient } from "@/lib/supabase/server";

// The link in the password-reset email lands here with a one-time code. It is exchanged for a short session
// (in this browser only: the browser that asked for the reset holds the matching verifier) and the person is sent to
// choose a new password. A link opened somewhere else says so, rather than claiming it expired. Links that carry the
// emailed token instead (/auth/confirm) work from any browser.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const fail = (message: string) => NextResponse.redirect(new URL(`/forgot-password?error=${encodeURIComponent(message)}`, request.url));
  if (!code) return fail(RESET_LINK_INVALID);
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail(callbackFailureMessage(error));
  const res = NextResponse.redirect(new URL("/reset-password", request.url));
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
