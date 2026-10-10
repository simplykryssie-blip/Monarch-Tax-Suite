"use server";

import { headers } from "next/headers";
import { requestInviteByEmail } from "@/lib/automation/invites.ts";
import { automationDeps } from "@/lib/automation/server";
import { clientAddress, hashClient, windowStart } from "@/lib/commerce/rate-limit.ts";
import { rateLimitStore } from "@/lib/rate-limit-server";

export type NewLinkState = { message?: string; ok?: boolean };

const SAME_ANSWER = "If that email address belongs to a Monarch Tax Suite license, we just sent it a new setup link. Check your inbox (and spam folder).";

/** Public "my link expired" form. Always answers the same way, so it cannot be used to discover customers. */
export async function requestNewLinkAction(_prev: NewLinkState, form: FormData): Promise<NewLinkState> {
  const ip = clientAddress((await headers()).get("x-forwarded-for"));
  try {
    if (ip) {
      const hits = await rateLimitStore().hit(`setup-new:ip:${hashClient(ip, process.env.MONARCH_ENCRYPTION_KEY)}`, windowStart(Date.now()).startIso);
      if (hits > 5) return { ok: false, message: "Too many requests. Please wait a minute and try again." };
    }
  } catch {
    // The counter store may not be installed; per-license limits still apply.
  }
  try {
    await requestInviteByEmail(automationDeps(), String(form.get("email") ?? ""));
  } catch (e) {
    console.error(`new setup link request failed: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`);
  }
  return { ok: true, message: SAME_ANSWER };
}
