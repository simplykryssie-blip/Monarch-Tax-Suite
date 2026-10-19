import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import type { ChecklistItem, Handoff, PrepRepo } from "./types.ts";

/** Checklist and handoff rows, on a tenant-scoped client: row-level security limits every call to that tenant. */
export class SupabasePrepRepo implements PrepRepo {
  constructor(private db: SupabaseClient) {}
  async listChecklist(returnId: string) {
    return unwrap(await this.db.from("return_checklist_items").select("*").eq("return_id", returnId).order("position").order("created_at")) as ChecklistItem[];
  }
  async insertChecklist(returnId: string, labels: string[], startAt: number) {
    if (!labels.length) return [];
    return unwrap(await this.db.from("return_checklist_items").insert(labels.map((label, i) => ({ return_id: returnId, label, position: startAt + i }))).select("*")) as ChecklistItem[];
  }
  async getChecklistItem(id: string) {
    return unwrap(await this.db.from("return_checklist_items").select("*").eq("id", id).maybeSingle()) as ChecklistItem | null;
  }
  async updateChecklistItem(id: string, patch: Partial<Pick<ChecklistItem, "done_at" | "done_by">>) {
    return unwrap(await this.db.from("return_checklist_items").update(patch).eq("id", id).select("*").single()) as ChecklistItem;
  }
  async deleteChecklistItem(id: string) {
    unwrap(await this.db.from("return_checklist_items").delete().eq("id", id));
  }
  async insertHandoff(input: Parameters<PrepRepo["insertHandoff"]>[0]) {
    return unwrap(await this.db.from("return_handoffs").insert(input).select("*").single()) as Handoff;
  }
  async listHandoffs(returnId: string) {
    return unwrap(await this.db.from("return_handoffs").select("*").eq("return_id", returnId).order("created_at", { ascending: false })) as Handoff[];
  }
}
