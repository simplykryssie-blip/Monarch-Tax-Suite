"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { loadBrand } from "@/lib/branding/server";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { portalInviteEmail, inviteClient, setPortalAccess, withdrawPortalInvite, type InvitableClient } from "@/lib/portal/service.ts";
import { portalInviteLink, portalMemberRepo, sendPortalEmail } from "@/lib/portal/server";
import { isArea, requirePrep } from "@/lib/prep/server";
import { loadClient } from "@/lib/prep/service.ts";
import { workspaceRepo } from "@/lib/workspace/server";
import { currentTenantId } from "@/lib/tenants.ts";

// Staff side of the client portal: invite a client, send a fresh link, withdraw an invite, turn a client's access off or
// on. The same panel appears on the admin client page and on the office and PTIN workspace client pages; each action
// re-checks who is acting, and only a client that person may see can be invited.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const to = (path: string, key: "notice" | "error", message: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;
const failure = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`portal staff action failed: ${sanitizeError(e, 200)}`);
  if (/relation|schema cache|does not exist/i.test(e instanceof Error ? e.message : "")) return "The client portal isn't installed yet. Apply the portal migration first.";
  return "That did not work. Nothing was changed. Please try again.";
};

type Staff = { tenantId: string; userId: string; client: InvitableClient; back: string };

/** Who is acting, which office, and the client (only one that person may see). */
async function staffFor(form: FormData): Promise<Staff> {
  const area = str(form, "area");
  const clientId = str(form, "client_id");
  if (!UUID.test(clientId)) throw new ValidationError("That client wasn't found.");
  if (area === "admin") {
    const admin = await requireAdmin();
    const client = await workspaceRepo().getClient(clientId);
    if (!client) throw new ValidationError("That client wasn't found.");
    return { tenantId: currentTenantId(), userId: admin.userId, client, back: `/workspace/clients/${clientId}?tab=portal` };
  }
  if (!isArea(area)) throw new ValidationError("That client wasn't found.");
  const ctx = await requirePrep(area, "clients.intake");
  const client = await loadClient(ctx.deps, ctx.scope, clientId);
  return { tenantId: ctx.tenantId, userId: ctx.userId, client, back: `${ctx.base}/clients/${clientId}` };
}

async function run(form: FormData, fn: (s: Staff) => Promise<string>) {
  let target: string;
  let back = "/";
  try {
    const s = await staffFor(form);
    back = s.back;
    target = to(s.back, "notice", await fn(s));
  } catch (e) {
    unstable_rethrow(e);
    target = to(back, "error", failure(e));
  }
  revalidatePath("/workspace", "layout");
  redirect(target);
}

export async function invitePortalAction(form: FormData) {
  await run(form, async (s) => {
    const { member, token, resent } = await inviteClient({ repo: portalMemberRepo(s.tenantId) }, s.userId, s.client);
    const office = (await loadBrand(s.tenantId)).name;
    const problem = await sendPortalEmail(s.tenantId, member.email, portalInviteEmail({ office, name: member.full_name, link: await portalInviteLink(token) }));
    return problem ? `The invite was created but the email didn't go out (${problem}). Send it again once email is set up.` : `${resent ? "A new invite" : "The invite"} was emailed to ${member.email}.`;
  });
}

export async function withdrawPortalAction(form: FormData) {
  await run(form, async (s) => {
    await withdrawPortalInvite({ repo: portalMemberRepo(s.tenantId) }, s.userId, s.client.id);
    return "Invite withdrawn.";
  });
}

export async function setPortalAccessAction(form: FormData) {
  await run(form, async (s) => {
    const on = str(form, "enabled") === "1";
    await setPortalAccess({ repo: portalMemberRepo(s.tenantId) }, s.userId, s.client.id, on);
    return on ? "Portal access turned on." : "Portal access turned off.";
  });
}
