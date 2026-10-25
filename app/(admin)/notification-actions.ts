"use server";

import { requireAdmin } from "@/lib/admin";
import { markAllRead, markRead } from "@/lib/notifications/service.ts";
import { notifyDeps } from "@/lib/notifications/server";

// The bell. Each action re-checks who is signed in; read state is per person.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function markNotificationReadAction(id: string): Promise<void> {
  const admin = await requireAdmin();
  if (!UUID.test(id)) return;
  await markRead(notifyDeps(), { id: admin.userId, isOwner: true }, [id]).catch(() => undefined);
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const admin = await requireAdmin();
  await markAllRead(notifyDeps(), { id: admin.userId, isOwner: true }).catch(() => undefined);
}
