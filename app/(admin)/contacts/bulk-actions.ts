"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { emitTagChanges } from "@/lib/automation/emit";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { BULK_MAX, changeTags, planBulk, type BulkOp } from "@/lib/contacts/bulk.ts";
import { parseContactKey } from "@/lib/contacts/combine.ts";
import { convertLeadToClient } from "@/lib/contacts/convert.ts";
import { loadContacts } from "@/lib/contacts/server";
import { leadsDeps } from "@/lib/leads/server";
import { assignLead, setLeadStatus } from "@/lib/leads/service.ts";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/leads/types.ts";
import { parseTags, TAG_LENGTH, TAG_MAX } from "@/lib/leads/tags.ts";
<<<<<<< HEAD
import { checkAssignee } from "@/lib/staff/assign.ts";
=======
import { checkAssignee, LEAD_ASSIGNMENT_INSTALLED } from "@/lib/staff/assign.ts";
>>>>>>> claude/archive-fix
import { listStaff } from "@/lib/staff/server";
import { workspaceRepo } from "@/lib/workspace/server";
import { assignClient, saveClientTags } from "@/lib/workspace/service.ts";

const OPS = new Set<string>(["assign", "convert", "tag_add", "tag_remove", "set_status"]);
const backTo = (raw: string) => (/^\/(?!\/)[A-Za-z0-9\-._~/?#=&%]*$/.test(raw) ? raw : "/contacts");
const to = (back: string, key: "notice" | "error", message: string) => `${back}${back.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;
const strOf = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One action on the contacts ticked in the list (or on the one whose own button was pressed): reassign, convert, add a tag or remove a tag. */
export async function bulkContactsAction(form: FormData) {
  const admin = await requireAdmin();
  const back = backTo(strOf(form, "back"));
  const one = strOf(form, "one");
  // Enter pressed in the tag box submits the form's first button (a hidden one). A typed tag then means "Add tag".
  const opSent = strOf(form, "op");
  const opRaw = one ? "convert" : opSent === "none" || !opSent ? (parseTags(strOf(form, "tag")).length ? "tag_add" : "") : opSent;
  let target: string;
  try {
    if (!OPS.has(opRaw)) throw new ValidationError("Tick the contacts, then press one of the buttons: Reassign, Convert leads to clients, Set lead status, Add tag or Remove tag.");
    const op = opRaw as BulkOp;
    const keys = (one ? [one] : form.getAll("key").filter((k): k is string => typeof k === "string")).filter((k) => parseContactKey(k));
    if (!keys.length) throw new ValidationError("Tick at least one contact first.");
    if (keys.length > BULK_MAX) throw new ValidationError(`Choose up to ${BULK_MAX} contacts at a time.`);
    const data = await loadContacts();
    const leadStatus = (id: string) => data.leads.find((l) => l.id === id)?.status ?? null;
    const { targets, skipped } = planBulk(data.contacts, keys, op, leadStatus);
    const actor = { id: admin.userId, email: admin.email };
    const repo = workspaceRepo();
    const leads = leadsDeps();
    let done = 0;
    let message: string;

    if (op === "assign") {
      const who = checkAssignee(await listStaff(), form.get("assignee"));
      for (const c of targets) {
<<<<<<< HEAD
        if (c.refs.clientId) await assignClient(repo, c.refs.clientId, who, actor);
        if (c.refs.leadId) await assignLead(leads, c.refs.leadId, who, admin.userId);
=======
        // A contact that is only a lead can't be assigned until lead assignment is installed.
        if (!c.refs.clientId && !LEAD_ASSIGNMENT_INSTALLED) { skipped.push({ name: c.name, reason: "leads can't be assigned yet" }); continue; }
        if (c.refs.clientId) await assignClient(repo, c.refs.clientId, who, actor);
        if (c.refs.leadId && LEAD_ASSIGNMENT_INSTALLED) await assignLead(leads, c.refs.leadId, who, admin.userId);
>>>>>>> claude/archive-fix
        done++;
      }
      message = who ? `Assigned ${plural(done, "contact", "contacts")} to ${who.label}.` : `${plural(done, "contact", "contacts")} now assigned to no one.`;
    } else if (op === "set_status") {
      const wanted = strOf(form, "status");
      for (const c of targets) { await setLeadStatus(leads, c.refs.leadId!, wanted, admin.userId); done++; }
      message = `Set ${plural(done, "lead", "leads")} to ${LEAD_STATUSES[wanted as LeadStatus]}.`;
    } else if (op === "convert") {
      let last: { id: string } | null = null;
      for (const c of targets) {
        const r = await convertLeadToClient(repo, leads, c.refs.leadId!, actor);
        last = r.client;
        done++;
      }
      message = `Converted ${plural(done, "lead", "leads")} to clients.`;
      if (one && last) { redirect(to(`/workspace/clients/${last.id}`, "notice", "Converted to a client. The lead is marked converted.")); }
    } else {
      const tag = parseTags(strOf(form, "tag"))[0];
      if (!tag) throw new ValidationError("Type a tag first.");
      if (tag.length > TAG_LENGTH) throw new ValidationError(`A tag can be up to ${TAG_LENGTH} characters.`);
      for (const c of targets) {
        if (c.refs.clientId) {
          const cur = (await repo.getClient(c.refs.clientId))?.tags ?? [];
          const next = changeTags(parseTags(cur), op, tag);
          if (op === "tag_add" && next.length > TAG_MAX) { skipped.push({ name: c.name, reason: "already has the most tags allowed" }); continue; }
          const r = await saveClientTags(repo, c.refs.clientId, next, actor);
          await emitTagChanges({ type: "client", id: c.refs.clientId }, r.before, r.after);
        }
        if (c.refs.leadId) {
          const lead = await leads.repo.getLead(c.refs.leadId);
          if (lead) {
            const next = changeTags(lead.tags, op, tag);
            if (op === "tag_add" && next.length > TAG_MAX) { skipped.push({ name: c.name, reason: "already has the most tags allowed" }); continue; }
            if (JSON.stringify(next) !== JSON.stringify(lead.tags)) {
              await leads.repo.updateLead(lead.id, { tags: next });
              await emitTagChanges({ type: "lead", id: lead.id }, lead.tags, next);
            }
          }
        }
        done++;
      }
      message = op === "tag_add" ? `Added the tag "${tag}" to ${plural(done, "contact", "contacts")}.` : `Removed the tag "${tag}" from ${plural(done, "contact", "contacts")}.`;
    }
    const note = skipped.length ? ` Skipped ${skipped.length}: ${skipped.slice(0, 3).map((s) => `${s.name} (${s.reason})`).join("; ")}${skipped.length > 3 ? "…" : ""}.` : "";
    target = done === 0 && skipped.length ? to(back, "error", `Nothing changed.${note}`) : to(back, "notice", `${message}${note}`);
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ValidationError) target = to(back, "error", e.message);
    else {
      console.error(`bulk contacts failed: ${sanitizeError(e, 200)}`);
      target = to(back, "error", "That did not work. Some contacts may not have changed. Please check the list and try again.");
    }
  }
  revalidatePath("/contacts", "layout");
  revalidatePath("/leads", "layout");
  revalidatePath("/workspace", "layout");
  redirect(target);
}
