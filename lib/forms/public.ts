import "server-only";
import { headers } from "next/headers";
import { clientAddress, hashClient } from "../commerce/rate-limit.ts";
import { ValidationError } from "../commerce/validation.ts";
import { rateLimitStore } from "../rate-limit-server";
import { formDeps, tenantForForm } from "./server";
import { brandFor, hashToken, publicForm, type FormDeps, type PublicForm } from "./service.ts";
import type { Submission } from "./types.ts";
import type { TenantProfile } from "../documents/types.ts";

// The public form page (/f/{public_id}). The public id names one form, and that form's tenant is the only tenant
// the request acts as.

/** `firmName`: the form's firm/brand, or the firm profile's name. */
export type FormContext = { tenantId: string; deps: FormDeps; pf: PublicForm | null; profile: TenantProfile | null; firmName: string };

export async function formContext(publicId: string): Promise<FormContext | null> {
  const tenantId = await tenantForForm(publicId).catch(() => null);
  if (!tenantId) return null;
  const deps = formDeps(tenantId);
  const [pf, profile] = await Promise.all([publicForm(deps, publicId), deps.profile()]);
  const brand = pf ? await brandFor(deps, pf.settings) : null;
  return { tenantId, deps, pf, profile, firmName: brand?.name ?? profile?.display_name ?? "" };
}

/** Limits per visitor (and per form), counted in fixed windows. Returns the visitor's hashed address and browser. */
export async function formVisitor(publicId: string, kind: "submit" | "upload" | "save"): Promise<{ ipHash: string | null; userAgent: string | null }> {
  const h = await headers();
  const ip = clientAddress(h.get("x-forwarded-for"));
  const ipHash = ip ? hashClient(ip, process.env.MONARCH_ENCRYPTION_KEY) : null;
  const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
  const store = rateLimitStore();
  const over = async (bucket: string, limit: number) => (await store.hit(bucket, hour).catch(() => 0)) > limit;
  const limits = { submit: { ip: 10, form: 300 }, upload: { ip: 60, form: 3000 }, save: { ip: 10, form: 300 } }[kind];
  if (ipHash && (await over(`form:${kind}:ip:${ipHash}:${publicId}`, limits.ip))) throw new ValidationError("Too many attempts from your connection. Please wait a while and try again.");
  if (await over(`form:${kind}:form:${publicId}`, limits.form)) throw new ValidationError("This form is very busy right now. Please try again in a few minutes.");
  return { ipHash: ipHash ? ipHash.slice(0, 32) : null, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

export const RECEIPT_COOKIE = "monarch_form_receipt";

/** Whether the receipt cookie still opens this submission's confirmation (right form, right token, under an hour old). */
export function receiptValid(sub: Submission | null, token: string | undefined, formId: string | undefined): sub is Submission {
  return !!(sub && token && formId && sub.form_id === formId && sub.receipt_token_hash === hashToken(token) && sub.receipt_expires_at && Date.parse(sub.receipt_expires_at) > Date.now());
}
