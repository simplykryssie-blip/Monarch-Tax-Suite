import type { SupabaseClient } from "@supabase/supabase-js";
import type { Notification, NotificationsRepo } from "./types.ts";

/** Notifications on a tenant-scoped client: row-level security limits every call to that tenant's rows. */
export class SupabaseNotificationsRepo implements NotificationsRepo {
  constructor(private db: SupabaseClient) {}

  async insert(n: Omit<Notification, "id" | "tenant_id" | "read_by" | "created_at">) {
    const { error } = await this.db.from("notifications").insert(n);
    if (error) {
      if (error.code === "23505") return false; // the same event was already reported
      throw new Error(`notification failed: ${error.message}`);
    }
    return true;
  }
  async listRecent(limit: number) {
    const { data, error } = await this.db.from("notifications").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(`notifications failed: ${error.message}`);
    return (data ?? []) as Notification[];
  }
  async markRead(ids: string[], userId: string) {
    const { data, error } = await this.db.from("notifications").select("id, read_by").in("id", ids);
    if (error) throw new Error(`notifications failed: ${error.message}`);
    for (const row of (data ?? []) as { id: string; read_by: string[] }[]) {
      if (row.read_by.includes(userId)) continue;
      const { error: e } = await this.db.from("notifications").update({ read_by: [...row.read_by, userId] }).eq("id", row.id);
      if (e) throw new Error(`notifications failed: ${e.message}`);
    }
  }
}
