import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import type { Week } from "./business.ts";
import type { BusinessRepo, ClosureRow, NewClosure } from "./service.ts";

/** The business calendar's rows, on a tenant-scoped client. */
export class SupabaseBusinessRepo implements BusinessRepo {
  constructor(private db: SupabaseClient) {}
  async getWeek() {
    const row = unwrap(await this.db.from("business_hours").select("week").maybeSingle()) as { week: Week } | null;
    return row?.week ?? null;
  }
  async saveWeek(week: Week) {
    const existing = unwrap(await this.db.from("business_hours").select("tenant_id").maybeSingle()) as { tenant_id: string } | null;
    if (existing) unwrap(await this.db.from("business_hours").update({ week }).eq("tenant_id", existing.tenant_id));
    else unwrap(await this.db.from("business_hours").insert({ week }));
  }
  async listClosures() { return unwrap(await this.db.from("business_closures").select("*").order("start_date")) as ClosureRow[]; }
  async insertClosures(rows: NewClosure[]) { if (rows.length) unwrap(await this.db.from("business_closures").insert(rows)); }
  async getClosure(id: string) { return unwrap(await this.db.from("business_closures").select("*").eq("id", id).maybeSingle()) as ClosureRow | null; }
  async updateClosure(id: string, patch: Partial<Pick<ClosureRow, "name" | "start_date" | "end_date" | "enabled">>) { unwrap(await this.db.from("business_closures").update(patch).eq("id", id)); }
  async deleteClosure(id: string) { unwrap(await this.db.from("business_closures").delete().eq("id", id)); }
}
