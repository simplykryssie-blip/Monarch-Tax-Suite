import { createHmac, timingSafeEqual } from "node:crypto";
import { ValidationError } from "../commerce/validation.ts";
import { EMAIL } from "../office/service.ts";
import { PLANS, isPlanKey, type PlanKey } from "./plans.ts";

// Self-serve signup, step one: the person gives their details and picks a plan; we email a signed link. The link holds
// those details (nothing is stored until they pay), so it can't be forged or edited, and it expires. Opening it leads to
// the payment page; the workspace is made only when the payment is confirmed.

export const SIGNUP_LINK_HOURS = 24;
export type SignupClaims = { email: string; name: string; workspace: string; plan: PlanKey; terms: string; exp: number };
export type SignupInput = { email: string; name: string; workspace: string; plan: PlanKey };

const fail = (m: string): never => { throw new ValidationError(m); };

export function cleanSignup(raw: { email?: unknown; name?: unknown; workspace?: unknown; plan?: unknown; agree?: unknown }): SignupInput {
  const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const email = str(raw.email).toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) fail("Enter a valid email address.");
  const name = str(raw.name);
  if (name.length < 2 || name.length > 200) fail("Enter your name.");
  const workspace = str(raw.workspace) || name;
  if (workspace.length < 2 || workspace.length > 120) fail("The workspace name must be 2 to 120 characters.");
  if (!isPlanKey(raw.plan)) fail("Choose a plan.");
  const plan = raw.plan as PlanKey;
  if (!PLANS[plan].selfServe) fail(`${PLANS[plan].label} accounts aren't open for self-serve signup yet. Contact us and we'll set you up.`);
  if (!(raw.agree === true || raw.agree === "on")) fail("Tick the box to agree to the Terms of Service, Privacy Policy and Acceptable Use Policy.");
  return { email, name, workspace, plan };
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const mac = (key: Buffer, body: string) => createHmac("sha256", key).update(`signup-link:v1:${body}`).digest("base64url");

export function signSignup(key: Buffer, input: SignupInput, terms: string, now: Date = new Date()): string {
  const claims: SignupClaims = { ...input, terms, exp: now.getTime() + SIGNUP_LINK_HOURS * 3_600_000 };
  const body = b64(JSON.stringify(claims));
  return `${body}.${mac(key, body)}`;
}

/** The details in a link, or null when it was changed, expired or is not a signup link. */
export function readSignup(key: Buffer, token: unknown, now: Date = new Date()): SignupClaims | null {
  if (typeof token !== "string" || token.length > 2000) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const want = mac(key, body);
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignupClaims;
    if (!isPlanKey(c.plan) || typeof c.email !== "string" || typeof c.name !== "string" || typeof c.workspace !== "string" || typeof c.exp !== "number") return null;
    return c.exp < now.getTime() ? null : c;
  } catch {
    return null;
  }
}

export function verificationEmail(input: { name: string; link: string; hours?: number }) {
  return {
    subject: "Confirm your email to finish creating your Verexa HQ account",
    text: [
      `Hi ${input.name},`,
      "",
      "Thanks for choosing Verexa HQ. Open this link to confirm your email and go on to payment (it works for " + (input.hours ?? SIGNUP_LINK_HOURS) + " hours):",
      input.link,
      "",
      "Your account is created once payment goes through. If you didn't ask for this, ignore this email and nothing happens.",
    ].join("\n"),
  };
}

export function existingAccountEmail(input: { name: string; link: string }) {
  return {
    subject: "You already have a Verexa HQ account",
    text: ["Hi " + input.name + ",", "", "Someone (we hope you) tried to sign up with this email address, but it already has a Verexa HQ account. Sign in here:", input.link, "", "If it wasn't you, you can ignore this email."].join("\n"),
  };
}
