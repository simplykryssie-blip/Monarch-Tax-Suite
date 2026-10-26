import "server-only";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import { bellFor, raise, type NotifyDeps } from "./service.ts";
import { SupabaseNotificationsRepo } from "./supabase-repo.ts";
import type { BellItem, NewNotification } from "./types.ts";

export function notifyDeps(tenantId: string = currentTenantId()): NotifyDeps {
  return { repo: new SupabaseNotificationsRepo(tenantClient(tenantId)) };
}

/** Raises a notification for a workspace. Never throws. */
export async function notify(tenantId: string, n: NewNotification): Promise<void> {
  try {
    await raise(notifyDeps(tenantId), n);
  } catch {
    /* the bell is a courtesy */
  }
}

/** What the bell shows this person. Empty when notifications aren't set up yet. */
export async function loadBell(userId: string): Promise<{ items: BellItem[]; unread: number }> {
  try {
    return await bellFor(notifyDeps(), { id: userId, isOwner: true });
  } catch {
    return { items: [], unread: 0 };
  }
}
