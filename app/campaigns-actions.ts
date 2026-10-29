"use server";

import { CAMPAIGN_WORDS } from "@/lib/campaigns/words.ts";
import { fromFriendlyWith } from "@/lib/ui/merge-words.ts";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { zonedToUtc } from "@/lib/calendar/business.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { LEAD_STATUSES } from "@/lib/campaigns/audience.ts";
import { isCampaignsArea, requireCampaigns, type CampaignsContext } from "@/lib/campaigns/context";
import { blockableEmail, markMarketable, oneTag, parsePicks, revokeMarketing } from "@/lib/campaigns/people.ts";
import { cancelCampaign, copyCampaign, saveCampaign, scheduleCampaign } from "@/lib/campaigns/service.ts";

// Campaign actions, for the main workspace and the PTIN workspace alike. Each one re-checks who is signed in and acts only
// on that area's office; a campaign id from another office is simply not found.

const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
const to = (path: string, key: "notice" | "error", message: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;
const failure = (e: unknown) => {
  if (e instanceof ValidationError) return e.message;
  console.error(`campaigns action failed: ${sanitizeError(e, 200)}`);
  if (/relation|schema cache|does not exist/i.test(e instanceof Error ? e.message : "")) return "Campaigns aren't installed yet. Apply the campaigns migration first.";
  return "That did not work. Nothing was changed. Please try again.";
};

async function run(form: FormData, page: string, fn: (ctx: CampaignsContext) => Promise<{ notice: string; to?: string }>) {
  const area = str(form, "area");
  if (!isCampaignsArea(area)) redirect("/");
  const ctx = await requireCampaigns(area);
  const home = `${ctx.base}${page}`;
  let target: string;
  try {
    const r = await fn(ctx);
    target = to(r.to ?? home, "notice", r.notice);
  } catch (e) {
    unstable_rethrow(e);
    target = to(home, "error", failure(e));
  }
  revalidatePath(ctx.base, "layout");
  redirect(target);
}

export async function createCampaignAction(form: FormData) {
  await run(form, "", async (ctx) => {
    const c = await saveCampaign(ctx.deps, null, { name: form.get("name"), channel: form.get("channel"), subject: "", body: "", audience: {}, respect_hours: true }, ctx.userId);
    return { notice: "Draft created. Write your message and choose who gets it.", to: `${ctx.base}/${c.id}` };
  });
}

/** What the audience controls on the page sent, as the filter the service cleans. */
function audienceFrom(form: FormData) {
  const mode = str(form, "mode") === "manual" ? "manual" : "filter";
  return {
    mode,
    kinds: form.getAll("kinds"),
    tagsAny: str(form, "tagsAny"),
    tagsNone: str(form, "tagsNone"),
    leadStatus: form.getAll("leadStatus").filter((s) => (LEAD_STATUSES as readonly string[]).includes(String(s))),
    picked: form.getAll("picked").map((v) => { const [kind, id] = String(v).split(":"); return { kind, id }; }),
  };
}

/** What a person typed in a message box, with [First name] turned back into the merge tag. */
const friendly = (v: FormDataEntryValue | null) => (typeof v === "string" ? fromFriendlyWith(CAMPAIGN_WORDS, v) : v);

export async function saveCampaignAction(form: FormData) {
  const id = str(form, "campaign_id");
  await run(form, `/${id}`, async (ctx) => {
    const c = await saveCampaign(ctx.deps, id, {
      name: form.get("name"), channel: str(form, "channel"), subject: friendly(form.get("subject")), body: friendly(form.get("body")),
      audience: audienceFrom(form), respect_hours: form.get("respect_hours") === "on", sender_id: str(form, "sender_id") || null,
    }, ctx.userId);
    const next = str(form, "then");
    if (next === "schedule") {
      const when = str(form, "when") === "later" ? await localTime(ctx, str(form, "send_at")) : null;
      await scheduleCampaign(ctx.deps, c.id, when);
      return { notice: when ? `Scheduled. It will start sending ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: (await ctx.deps.calendar()).timeZone }).format(when)}.` : "Sending has been queued. It starts within five minutes." };
    }
    return { notice: "Draft saved." };
  });
}

/** A "2026-03-04T09:30" typed in the office's time zone, as the moment it means. */
async function localTime(ctx: CampaignsContext, raw: string): Promise<Date> {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) throw new ValidationError("Choose the date and time to send.");
  return zonedToUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), (await ctx.deps.calendar()).timeZone);
}

export async function cancelCampaignAction(form: FormData) {
  const id = str(form, "campaign_id");
  await run(form, `/${id}`, async (ctx) => {
    await cancelCampaign(ctx.deps, id);
    return { notice: "Campaign cancelled. Anything already sent stays sent." };
  });
}

export async function resumeCampaignAction(form: FormData) {
  const id = str(form, "campaign_id");
  await run(form, `/${id}`, async (ctx) => {
    const c = (await ctx.deps.repo.getCampaign(id)) ?? (() => { throw new ValidationError("That campaign wasn't found."); })();
    if (c.status !== "paused") throw new ValidationError("Only a paused campaign can be resumed.");
    // Checks the sender, health and message again before it goes on.
    const { scheduleProblems } = await import("@/lib/campaigns/service.ts");
    const problems = await scheduleProblems(ctx.deps, c);
    if (problems.length) throw new ValidationError(problems[0]);
    await ctx.deps.repo.updateCampaign(id, { status: "sending", paused_reason: null });
    return { notice: "Resumed. Sending continues within five minutes." };
  });
}

export async function copyCampaignAction(form: FormData) {
  await run(form, "", async (ctx) => {
    const c = await copyCampaign(ctx.deps, str(form, "campaign_id"), ctx.userId);
    return { notice: "Copied as a new draft.", to: `${ctx.base}/${c.id}` };
  });
}

export async function deleteDraftAction(form: FormData) {
  const id = str(form, "campaign_id");
  await run(form, "", async (ctx) => {
    const c = await ctx.deps.repo.getCampaign(id);
    if (!c || c.status !== "draft") throw new ValidationError("Only a draft can be deleted.");
    await ctx.deps.repo.deleteDraft(id);
    return { notice: "Draft deleted." };
  });
}

// ------------------------------------------------------------------ saved audiences

export async function saveSegmentAction(form: FormData) {
  const id = str(form, "campaign_id");
  await run(form, `/${id}`, async (ctx) => {
    const name = str(form, "segment_name").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name) throw new ValidationError("Name the saved audience.");
    const { sanitizeFilter } = await import("@/lib/campaigns/audience.ts");
    await ctx.deps.repo.saveSegment(name, sanitizeFilter(audienceFrom(form)), ctx.userId);
    return { notice: `Saved the audience "${name}". Use it from any campaign.` };
  });
}

export async function useSegmentAction(form: FormData) {
  const id = str(form, "campaign_id");
  await run(form, `/${id}`, async (ctx) => {
    const seg = (await ctx.deps.repo.listSegments()).find((s) => s.id === str(form, "segment_id"));
    if (!seg) throw new ValidationError("That saved audience wasn't found.");
    const c = await ctx.deps.repo.getCampaign(id);
    if (!c || c.status !== "draft") throw new ValidationError("Only a draft can be changed.");
    const { sanitizeFilter } = await import("@/lib/campaigns/audience.ts");
    await ctx.deps.repo.updateCampaign(id, { audience: sanitizeFilter(seg.filter) });
    return { notice: `Using "${seg.name}".` };
  });
}

export async function removeSegmentAction(form: FormData) {
  const id = str(form, "campaign_id");
  await run(form, id ? `/${id}` : "/contacts", async (ctx) => {
    await ctx.deps.repo.removeSegment(str(form, "segment_id"));
    return { notice: "Saved audience removed." };
  });
}

// ------------------------------------------------------------------ contacts and consent

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function consentAction(form: FormData) {
  await run(form, "/contacts", async (ctx) => {
    const picks = parsePicks(form.getAll("pick"));
    const op = str(form, "op");
    if (op === "marketable" || op === "marketable_sms") {
      const r = await markMarketable(ctx.deps.repo, picks, { sms: op === "marketable_sms", userId: ctx.userId });
      return { notice: `${plural(r.changed, "person is", "people are")} now marked as OK to send campaigns${op === "marketable_sms" ? " (including texts)" : ""}.${r.noEmail ? ` ${plural(r.noEmail, "person has", "people have")} no email address, so can't be marked.` : ""}` };
    }
    if (op === "revoke") {
      const r = await revokeMarketing(ctx.deps.repo, picks, ctx.userId);
      return { notice: `${plural(r.changed, "person", "people")} will no longer be sent campaigns.` };
    }
    if (op === "tag_add" || op === "tag_remove") {
      const tag = oneTag(form.get("tag"));
      let changed = 0;
      for (const kind of ["lead", "client"] as const) {
        const ids = picks.filter((p) => p.kind === kind).map((p) => p.id);
        if (ids.length) changed += await ctx.deps.repo.tagContacts(kind, ids, tag, op === "tag_remove");
      }
      return { notice: `Tag "${tag}" ${op === "tag_add" ? "added to" : "removed from"} ${plural(changed, "person", "people")}.` };
    }
    throw new ValidationError("Choose what to do with the people you ticked.");
  });
}

export async function blockEmailAction(form: FormData) {
  await run(form, "/contacts", async (ctx) => {
    const email = blockableEmail(form.get("email"));
    await ctx.deps.repo.addSuppression("email", email, "manual", null);
    await ctx.deps.repo.skipQueuedFor(email, "blocked by the office");
    return { notice: `${email} will not be sent campaigns.` };
  });
}

export async function unblockAction(form: FormData) {
  await run(form, "/contacts", async (ctx) => {
    const channel = str(form, "channel") === "sms" ? "sms" : "email";
    // Only a block the office added itself can be lifted here. An unsubscribe, a STOP, a bounce or a complaint never is.
    await ctx.deps.repo.removeSuppression(channel, str(form, "address").toLowerCase(), "manual");
    return { notice: "Block removed." };
  });
}
