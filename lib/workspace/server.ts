import "server-only";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import { SupabaseWorkspaceRepo } from "./supabase-repo.ts";

export const workspaceRepo = (tenantId: string = currentTenantId()) => new SupabaseWorkspaceRepo(tenantClient(tenantId));

import { SupabaseDocumentStore } from "../documents/supabase-repo.ts";
import type { DocDeps } from "./docs.ts";

export function docDeps(tenantId: string = currentTenantId()): DocDeps {
  const db = tenantClient(tenantId);
  return { tenantId, repo: new SupabaseWorkspaceRepo(db), store: new SupabaseDocumentStore(db) };
}
