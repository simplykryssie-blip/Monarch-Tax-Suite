"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { automationDeps } from "@/lib/automation/server";
import { senderFor } from "@/lib/automation/engine.ts";
import { documentDeps } from "@/lib/documents/server";
import { deliveryPathFor } from "@/lib/documents/service.ts";
import { documentEmail } from "@/lib/documents/emails.ts";
import { sendForSignature } from "@/lib/portal/signing.ts";
import { ssnDeps } from "@/lib/ssn/server";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { loadBrand } from "@/lib/branding/server";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { portalInviteEmail, inviteClient, setPortalAccess, withdrawPortalInvite } from "@/lib/portal/service.ts";
import type { Client } from "@/lib/workspace/types";
import { portalInviteLink, portalMemberRepo, portalStaffRepo, sendPortalEmail } from "@/lib/portal/server";
import { isArea, requirePrep } from "@/lib/prep/server";
import { loadClient } from "@/lib/prep/service.ts";
import { cancelRequest, requestDocument, setDocShared } from "@/lib/portal/staff-docs.ts";
import { clientDocLink } from "@/lib/workspace/docs.ts";
import { docDeps, workspaceRepo } from "@/lib/workspace/server";
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

type Staff = { tenantId: string; userId: string; client: Client; back: string };

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

export async function requestDocAction(form: FormData) {
  await run(form, async (s) => {
    await requestDocument(portalStaffRepo(s.tenantId), s.client.id, { title: form.get("title"), note: form.get("note"), due_on: form.get("due_on") }, s.userId);
    return "Request added. The client sees it in their portal.";
  });
}

export async function cancelRequestAction(form: FormData) {
  await run(form, async (s) => {
    await cancelRequest(portalStaffRepo(s.tenantId), s.client.id, str(form, "request_id"), s.userId);
    return "Request cancelled.";
  });
}

export async function shareDocAction(form: FormData) {
  await run(form, async (s) => {
    const shared = str(form, "shared") === "1";
    await setDocShared(portalStaffRepo(s.tenantId), s.client.id, str(form, "doc_id"), shared, s.userId);
    return shared ? "Shared with the client." : "Hidden from the client.";
  });
}

/** A one-minute download link for one of this client's documents. */
export async function openStaffDocAction(form: FormData) {
  let url: string | null = null;
  let back = "/";
  let message = "";
  try {
    const s = await staffFor(form);
    back = s.back;
    const doc = await portalStaffRepo(s.tenantId).getDoc(str(form, "doc_id"));
    if (!doc || doc.client_id !== s.client.id) throw new ValidationError("That document wasn't found.");
    url = await clientDocLink(docDeps(s.tenantId), doc.id);
  } catch (e) {
    unstable_rethrow(e);
    message = failure(e);
  }
  redirect(url ?? to(back, "error", message));
}

/** Admin workspace only: the document library lives there. Sends a library document to the client for signature and emails the link. */
export async function sendSignatureAction(form: FormData) {
  await run(form, async (s) => {
    if (str(form, "area") !== "admin") throw new ValidationError("Sending documents to sign is available from the main workspace.");
    const asks = Object.fromEntries([...form.entries()].filter(([k, v]) => k.startsWith("ask.") && typeof v === "string"));
    const auto = automationDeps(s.tenantId);
    const made = await sendForSignature({ docs: documentDeps(s.tenantId), ssn: ssnDeps(s.tenantId) }, { documentId: str(form, "document_id"), client: s.client, asks, actorId: s.userId });
    const to = s.client.email!;
    if (auto.config.env !== "production" && !auto.config.testRecipients.map((r) => r.toLowerCase()).includes(to.toLowerCase())) {
      throw new ValidationError(`The request was saved for the portal, but this is a ${auto.config.env} environment: emails go only to the addresses in AUTOMATION_TEST_RECIPIENTS.`);
    }
    const origin = (await auto.config.origin()).replace(/\/$/, "");
    const mail = documentEmail({ kind: "signature", firmName: made.firmName, documentName: made.document.name, clientFirstName: made.firstName || null, message: str(form, "message").slice(0, 1000), url: `${origin}${deliveryPathFor("signature", made.token)}`, expiresAt: new Date(made.delivery.expires_at) });
    const result = await auto.email.send({ ...(await senderFor(auto, null)), to, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: `portal-sign:${made.delivery.id}` });
    if (!result.ok) throw new ValidationError(`The request is in the client's portal, but the email was not sent: ${result.message}`);
    return `"${made.document.name}" was sent to ${to} and is waiting in their portal.`;
  });
}

