import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import type { ImagesRepo, NewTenantImage, TenantImage } from "./service.ts";

/** tenant_images on the tenant client: row-level security limits every call to that tenant's rows. */
export class SupabaseImagesRepo implements ImagesRepo {
  constructor(private db: SupabaseClient) {}
  async list(limit: number) { return unwrap(await this.db.from("tenant_images").select("*").order("created_at", { ascending: false }).limit(limit)) as TenantImage[]; }
  async get(id: string) { return unwrap(await this.db.from("tenant_images").select("*").eq("id", id).maybeSingle()) as TenantImage | null; }
  async insert(input: NewTenantImage) { return unwrap(await this.db.from("tenant_images").insert(input).select("*").single()) as TenantImage; }
  async remove(id: string) { unwrap(await this.db.from("tenant_images").delete().eq("id", id)); }
}
