"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { currentTenantId } from "@/lib/tenants";
import { deliver, sendPlanEmail } from "@/lib/wisp/service.ts";
import { wispDeps } from "@/lib/wisp/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const safeBack = (raw: unknown) => (typeof raw === "string" && /^\/(?![/\\])[\w\-/?=&.%]*$/.test(raw) ? raw : "/store/wisp");
const withParam = (path: string, key: "notice" | "error", m: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(m)}`;

/** Emails a paid WISP to its buyer again (or makes and sends it, if that never happened). Logged as an admin send. */
export async function adminResendWispAction(form: FormData) {
  await requireAdmin();
  const back = safeBack(form.get("back"));
  const id = String(form.get("id") ?? "");
  let target: string;
  try {
    if (!UUID.test(id)) throw new ValidationError("WISP not found.");
    const deps = wispDeps(currentTenantId());
    const plan = await deps.repo.getPlan(id);
    if (!plan) throw new ValidationError("WISP not found.");
    if (plan.status === "draft") throw new ValidationError("This WISP was never paid for, so there is nothing to send.");
    const after = plan.pdf_path ? await sendPlanEmail(deps, plan, "admin") : await deliver(deps, plan, "admin");
    target = after.email_error ? withParam(back, "error", `Not sent: ${after.email_error}`) : withParam(back, "notice", `Sent to ${after.email}.`);
  } catch (e) {
    target = withParam(back, "error", e instanceof ValidationError ? e.message : "That did not work. Please try again.");
    if (!(e instanceof ValidationError)) console.error(`wisp admin resend failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
  }
  revalidatePath("/store/wisp");
  redirect(target);
}
