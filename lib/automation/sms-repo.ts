import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SmsRepo, SmsTemplate } from "./sms.ts";

const unwrap = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export class SupabaseSmsRepo implements SmsRepo {
  constructor(private db: SupabaseClient) {}
  async list() { return unwrap(await this.db.from("sms_templates").select("*").order("name")) as SmsTemplate[]; }
  async get(id: string) { return unwrap(await this.db.from("sms_templates").select("*").eq("id", id).maybeSingle()) as SmsTemplate | null; }
  async insert(input: { name: string; body: string; created_by: string | null }) { return unwrap(await this.db.from("sms_templates").insert(input).select("*").single()) as SmsTemplate; }
  async update(id: string, patch: Partial<Pick<SmsTemplate, "name" | "body" | "active">>) { return unwrap(await this.db.from("sms_templates").update(patch).eq("id", id).select("*").single()) as SmsTemplate; }
}
