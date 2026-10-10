import { NextResponse, type NextRequest } from "next/server";
import { automationDeps, safeEmit, setupSecrets } from "@/lib/automation/server";
import { OPEN_MESSAGES, openSetupLink, SETUP_COOKIE } from "@/lib/automation/onboarding.ts";
import { clientAddress, hashClient, windowStart } from "@/lib/commerce/rate-limit.ts";
import { rateLimitStore } from "@/lib/rate-limit-server";

// The secure setup link from the customer's email: /setup?t=<token>. It exchanges the token for a short-lived,
// HttpOnly session cookie and redirects to /integrations, so the token does not stay in the address bar, history
// or Referer headers. Tokens are random, expire, can be revoked, and only their hash is stored.
const LIMIT_PER_MINUTE = 20;

function back(request: NextRequest, message: string) {
  const res = NextResponse.redirect(new URL(`/integrations?error=${encodeURIComponent(message)}`, request.url), 303);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}

export async function GET(request: NextRequest) {
  const secrets = setupSecrets();
  if (!secrets) return back(request, "Setup links are not available yet. Please contact Monarch Tax Suite.");

  const ip = clientAddress(request.headers.get("x-forwarded-for"));
  if (ip) {
    try {
      const hits = await rateLimitStore().hit(`setup:ip:${hashClient(ip, process.env.MONARCH_ENCRYPTION_KEY)}`, windowStart(Date.now()).startIso);
      if (hits > LIMIT_PER_MINUTE) return back(request, "Too many attempts. Please wait a minute and try again.");
    } catch {
      // The counter store may not be installed; the token itself is the protection.
    }
  }

  const token = request.nextUrl.searchParams.get("t") ?? "";
  const deps = automationDeps();
  let opened;
  try {
    opened = await openSetupLink({ repo: deps.repo, commerce: deps.commerce, secrets }, token);
  } catch {
    return back(request, "Setup is temporarily unavailable. Please try again in a few minutes.");
  }
  if (!opened.ok) return back(request, OPEN_MESSAGES[opened.reason]);

  // Opening the link is recorded as "started", never as "completed".
  if (opened.firstOpen) await safeEmit({ type: "onboarding.started", key: `onboarding:${opened.linkId}`, licenseId: opened.licenseId });

  const res = NextResponse.redirect(new URL("/integrations", request.url), 303);
  res.cookies.set(SETUP_COOKIE, opened.session, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/integrations", maxAge: opened.maxAgeSeconds });
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
