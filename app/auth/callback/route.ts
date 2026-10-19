import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The link in the password-reset email lands here with a one-time code. It is exchanged for a short session
// (in this browser only) and the person is sent to choose a new password.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const fail = (message: string) => NextResponse.redirect(new URL(`/forgot-password?error=${encodeURIComponent(message)}`, request.url));
  if (!code) return fail("That reset link is not valid. Request a new one.");
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail("That reset link has expired or was already used. Request a new one.");
  const res = NextResponse.redirect(new URL("/reset-password", request.url));
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
