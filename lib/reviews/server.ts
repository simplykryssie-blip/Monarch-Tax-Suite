import "server-only";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import { SupabaseReviewsRepo } from "./supabase-repo.ts";

export const reviewsRepo = (tenantId: string = currentTenantId()) => new SupabaseReviewsRepo(tenantClient(tenantId));
