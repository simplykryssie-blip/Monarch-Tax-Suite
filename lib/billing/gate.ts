import type { AccessLevel } from "./access.ts";

// What a workspace may open and do in each state of its subscription. Pure, so it can be tested. The Billing page is
// always reachable (to fix the problem), and so are Security and the sign-in steps.

const ALWAYS = ["/practice/billing", "/practice/security", "/practice/mfa", "/practice/invite"];
const startsWith = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
const READ = new Set(["GET", "HEAD", "OPTIONS"]);

export type GateDecision = { allowed: true } | { allowed: false; message: string };

export function gateFor(level: AccessLevel, pathname: string, method: string): GateDecision {
  if (level === "full" || level === "grace") return { allowed: true };
  if (ALWAYS.some((p) => startsWith(pathname, p))) return { allowed: true };
  if (level === "read_only") {
    return READ.has(method.toUpperCase()) ? { allowed: true } : { allowed: false, message: "Your workspace is read-only because payment is overdue. Update your card in Billing to make changes." };
  }
  if (level === "contacts_only") {
    return pathname === "/practice" || startsWith(pathname, "/practice/clients")
      ? { allowed: true }
      : { allowed: false, message: "Your plan is paused, so only clients and contacts are available. Resume your plan in Billing to use everything." };
  }
  return { allowed: false, message: "Your account is cancelled. You can reactivate it here, within 90 days of cancelling, to get everything back." };
}
