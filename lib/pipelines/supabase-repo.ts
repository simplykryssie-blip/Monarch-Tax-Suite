import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pipeline, PipelineInput, PipelinesRepo } from "./types.ts";

const unwrap = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export class SupabasePipelinesRepo implements PipelinesRepo {
  constructor(private db: SupabaseClient) {}
  async list() { return unwrap(await this.db.from("pipelines").select("*").order("created_at")) as Pipeline[]; }
  async get(id: string) { return unwrap(await this.db.from("pipelines").select("*").eq("id", id).maybeSingle()) as Pipeline | null; }
  async insert(input: PipelineInput & { is_default: boolean; created_by: string | null }) { return unwrap(await this.db.from("pipelines").insert(input).select("*").single()) as Pipeline; }
  async update(id: string, patch: Partial<Pick<Pipeline, "name" | "stages" | "is_default" | "archived_at">>) { return unwrap(await this.db.from("pipelines").update(patch).eq("id", id).select("*").single()) as Pipeline; }
  async remove(id: string) { unwrap(await this.db.from("pipelines").delete().eq("id", id)); }
}
