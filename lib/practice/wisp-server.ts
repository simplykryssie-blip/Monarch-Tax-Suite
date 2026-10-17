import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import { automationDeps } from "../automation/server";
import { CrmSecrets } from "../crm/crypto.ts";
import { SupabaseDocumentStore } from "../documents/supabase-repo.ts";
import { PLATFORM } from "../platform-brand";
import { appOrigin } from "../admin";
import { platformClient, tenantClient } from "../supabase/service";
import { MONARCH_TENANT_ID } from "../tenants.ts";
import { practiceRepo } from "./server";
import { archiveIfLinked, reminderEmail, reminderOwed, type PracticeWisp, type PracticeWispDeps, type PracticeWispRepo } from "./wisp.ts";

// Server wiring for the independent PTIN holder's WISP.

export class SupabasePracticeWispRepo implements PracticeWispRepo {
  constructor(private db: SupabaseClient) {}
  async getLive() { return unwrap(await this.db.from("practice_wisps").select("*").neq("status", "archived").limit(1).maybeSingle()) as PracticeWisp | null; }
  async list() { return unwrap(await this.db.from("practice_wisps").select("*").order("created_at", { ascending: false })) as PracticeWisp[]; }
  async findBySession(sessionId: string) { return unwrap(await this.db.from("practice_wisps").select("*").eq("stripe_session_id", sessionId).maybeSingle()) as PracticeWisp | null; }
  async insert(input: Parameters<PracticeWispRepo["insert"]>[0]) { return unwrap(await this.db.from("practice_wisps").insert(input).select("*").single()) as PracticeWisp; }
  async update(id: string, patch: Partial<PracticeWisp>) { return unwrap(await this.db.from("practice_wisps").update(patch).eq("id", id).select("*").single()) as PracticeWisp; }
}

/** True while this account has an active seat in an ERO's office (the definition of "linked to an ERO"). */
export async function isLinkedToEro(userId: string): Promise<boolean> {
  const { data } = await platformClient("office_member").from("office_members").select("id").eq("user_id", userId).eq("status", "active").limit(1).maybeSingle();
  return !!data;
}

export function practiceWispDeps(tenantId: string, userId: string): PracticeWispDeps {
  const secrets = CrmSecrets.fromBase64(process.env.MONARCH_ENCRYPTION_KEY);
  if (!secrets) throw new Error("MONARCH_ENCRYPTION_KEY is not configured, so WISP answers cannot be stored securely.");
  const db = tenantClient(tenantId);
  const audit = practiceRepo(tenantId);
  return {
    tenantId, repo: new SupabasePracticeWispRepo(db), store: new SupabaseDocumentStore(db), secrets,
    brandName: async () => PLATFORM.name, isLinked: () => isLinkedToEro(userId), audit: (a) => audit.addAudit(a),
  };
}

/** The deps for a payment arriving from Stripe: there is no signed-in person, only the tenant the checkout was started for. */
export function practiceWispPaymentDeps(tenantId: string): PracticeWispDeps {
  return { ...practiceWispDeps(tenantId, "00000000-0000-4000-8000-000000000000"), isLinked: async () => false };
}

/** When someone joins an ERO's office, their independent WISP (if they have one) is archived. */
export async function archiveWispForUser(userId: string): Promise<void> {
  const { data } = await platformClient("practice_member").from("practice_members").select("tenant_id").eq("user_id", userId).maybeSingle();
  const tenantId = (data as { tenant_id: string } | null)?.tenant_id;
  if (tenantId) await archiveIfLinked(practiceWispDeps(tenantId, userId), userId);
}

/**
 * The daily sweep over every independent WISP: archives those whose holder has since linked to an ERO, and sends the
 * 30-day and 7-day review reminders. Each WISP is handled on its own, so one failure never stops the rest.
 */
export async function runPracticeWispSweep(at: Date = new Date()): Promise<{ checked: number; archived: number; reminded: number; failed: number }> {
  const { data } = await platformClient("practice_wisp_sweep").from("practice_wisps").select("id, tenant_id").neq("status", "archived").limit(2000);
  const live = (data ?? []) as { id: string; tenant_id: string }[];
  const auto = automationDeps(MONARCH_TENANT_ID);
  const sender = auto.fallbackSender;
  let archived = 0, reminded = 0, failed = 0;
  for (const { id, tenant_id } of live) {
    try {
      const owner = (await practiceRepo(tenant_id).listMembers()).find((m) => m.status === "active" && m.user_id);
      if (!owner?.user_id) continue;
      const deps = { ...practiceWispDeps(tenant_id, owner.user_id), now: () => at };
      if (await archiveIfLinked(deps, null)) { archived++; continue; }
      const w = (await deps.repo.list()).find((x) => x.id === id);
      const days = w ? reminderOwed(w, at) : null;
      if (!w || !days || !sender || !w.review_due_on) continue;
      if (auto.config.env !== "production" && !auto.config.testRecipients.map((r) => r.toLowerCase()).includes(owner.email.toLowerCase())) continue;
      const mail = reminderEmail({ name: owner.full_name, practice: w.practice_name, days, dueOn: w.review_due_on, link: `${(await appOrigin()).replace(/\/$/, "")}/practice/wisp`, brand: PLATFORM.name });
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const result = await auto.email.send({ to: owner.email, subject: mail.subject, text: mail.text, html: mail.text.split("\n\n").map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join(""), idempotencyKey: `practice-wisp:${w.id}:${w.review_due_on}:${days}`, from: sender.from, replyTo: sender.replyTo });
      if (!result.ok) { failed++; continue; }
      await deps.repo.update(w.id, days === 30 ? { reminder_30_sent_at: at.toISOString() } : { reminder_7_sent_at: at.toISOString() });
      await deps.audit({ actor_id: null, action: "wisp_review_reminder_sent", subject_type: "practice_wisp", subject_id: w.id, detail: { days } });
      reminded++;
    } catch (e) {
      failed++;
      console.error(`practice-wisp-sweep: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
    }
  }
  return { checked: live.length, archived, reminded, failed };
}
