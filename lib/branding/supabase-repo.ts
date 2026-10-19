import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import type { BrandInput, TenantBrandRow } from "./brand.ts";

export interface BrandRepo {
  get(): Promise<TenantBrandRow | null>;
  save(input: BrandInput, userId: string | null): Promise<TenantBrandRow>;
}

/** The tenant's brand, on a tenant-scoped client (row-level security limits it to that tenant's row). */
export class SupabaseBrandRepo implements BrandRepo {
  constructor(private db: SupabaseClient, private tenantId: string) {}
  async get() {
    return unwrap(await this.db.from("tenant_brands").select("*").eq("tenant_id", this.tenantId).maybeSingle()) as TenantBrandRow | null;
  }
  async save(input: BrandInput, userId: string | null) {
    return unwrap(await this.db.from("tenant_brands").upsert({ ...input, tenant_id: this.tenantId, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" }).select("*").single()) as TenantBrandRow;
  }
}
