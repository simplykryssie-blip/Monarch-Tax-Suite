import "server-only";
import { redirect } from "next/navigation";
import { automationDeps } from "../automation/server";
import { resolveSender, type ResolvedSender } from "../automation/senders.ts";
import { ValidationError } from "../commerce/validation.ts";
import { can } from "../office/permissions.ts";
import { officeDeps, requireOffice } from "../office/server";
import { pipelinesRepo } from "../pipelines/server";
import { returnsStages } from "../pipelines/service.ts";
import { practiceRepo, requirePractice } from "../practice/server";
import { tenantClient } from "../supabase/service";
import { MONARCH_TENANT_ID } from "../tenants.ts";
import { SupabaseWorkspaceRepo } from "../workspace/supabase-repo.ts";
import type { HandoffMail } from "./service.ts";
import { SupabasePrepRepo } from "./supabase-repo.ts";
import type { PrepDeps, Scope } from "./types.ts";

// Server wiring for the return-prep layer. The same screens and actions serve the independent PTIN holder's
// workspace ("practice") and the office area ("office"); each area supplies who is working and what they may see.

export type PrepArea = "practice" | "office";
export type PrepFeature = "clients.intake" | "returns.prep" | "returns.assigned";
export type PrepContext = {
  area: PrepArea;
  /** Where this area's prep pages live. */
  base: string;
  tenantId: string;
  userId: string;
  name: string;
  email: string;
  scope: Scope;
  deps: PrepDeps;
  /** Everyone a return can be assigned to in this account or office (active members), by sign-in id. */
  members: { id: string; name: string }[];
  /** Only an independent PTIN holder hands returns to an outside ERO; an office's preparers send theirs on for review. */
  canHandOff: boolean;
};

export function prepDeps(tenantId: string): PrepDeps {
  const db = tenantClient(tenantId);
  const audit = practiceRepo(tenantId);
  return { ws: new SupabaseWorkspaceRepo(db), prep: new SupabasePrepRepo(db), audit: (a) => audit.addAudit(a) };
}

export const isArea = (v: unknown): v is PrepArea => v === "practice" || v === "office";

/** The caller's context in an area. Not allowed → sent where they belong; the area guards run first (sign-in, two-step). */
export async function requirePrep(area: PrepArea, feature: PrepFeature): Promise<PrepContext> {
  if (area === "practice") {
    const ctx = await requirePractice();
    return { area, base: "/practice", tenantId: ctx.tenantId, userId: ctx.userId, name: ctx.member.full_name, email: ctx.email, scope: { userId: ctx.userId, all: false, organizationId: null }, deps: prepDeps(ctx.tenantId), members: [{ id: ctx.userId, name: ctx.member.full_name }], canHandOff: true };
  }
  const ctx = await requireOffice();
  if (!can(ctx.role, ctx.permissions, feature)) redirect("/office");
  const team = await officeDeps(ctx.tenantId).repo.listMembers(ctx.office.id);
  const members = team.filter((m) => m.status === "active" && m.user_id).map((m) => ({ id: m.user_id!, name: m.full_name }));
  // An ERO (and the bureau, looking in) sees the whole office; a preparer sees their own clients and assigned returns.
  const all = ctx.role === "ero" || ctx.bureau;
  return { area, base: "/office", tenantId: ctx.tenantId, userId: ctx.userId, name: ctx.member?.full_name ?? ctx.email, email: ctx.email, scope: { userId: ctx.userId, all, organizationId: ctx.office.id }, deps: prepDeps(ctx.tenantId), members, canHandOff: false };
}

/** The stage a new return starts in: the first stage of the account's returns pipeline. */
export async function firstReturnStage(tenantId: string): Promise<string> {
  return returnsStages(await pipelinesRepo(tenantId).list().catch(() => [])).stages[0].id;
}

/**
 * How a handoff is emailed. From the account's own verified address when it has one; otherwise from the platform's
 * address, with the holder's own email as the reply-to, so the ERO answers the holder.
 */
export function handoffMail(ctx: PrepContext): HandoffMail {
  const a = automationDeps(ctx.tenantId);
  const platform = automationDeps(MONARCH_TENANT_ID).fallbackSender;
  const sender = async (): Promise<ResolvedSender> => {
    try {
      return await resolveSender(a.senders ?? null, null, a.fallbackSender ?? null);
    } catch (e) {
      if (e instanceof ValidationError && platform) return platform;
      throw e;
    }
  };
  return { email: a.email, sender, env: a.config.env, testRecipients: a.config.testRecipients, docs: async (clientId) => (await ctx.deps.ws.listDocs(clientId)).map((d) => ({ title: d.title, file_type: d.file_type })), preparerName: ctx.name, preparerEmail: ctx.email || null };
}
