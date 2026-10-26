import type { BellItem, NewNotification, Notification, NotificationsRepo } from "./types.ts";

// Writing and reading the bell. Raising a notification never fails the thing that caused it.

export type NotifyDeps = { repo: NotificationsRepo };
export const BELL_LIMIT = 30;
/** Older than this and an item drops off the bell (it is kept in the database). */
export const BELL_DAYS = 30;

const trim = (v: string | null | undefined, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Adds one notification. Best effort: a problem here is logged by the caller, never thrown into the booking, upload or signing. */
export async function raise(d: NotifyDeps, n: NewNotification): Promise<void> {
  const title = trim(n.title, 200);
  if (!title || !n.href.startsWith("/")) return;
  try {
    await d.repo.insert({
      kind: trim(n.kind, 60), title, detail: trim(n.detail, 300) || null, href: n.href.slice(0, 300),
      client_id: n.clientId ?? null, owner_id: n.ownerId ?? null, actor_id: n.actorId ?? null, dedupe_key: n.dedupeKey ? trim(n.dedupeKey, 200) : null,
    });
  } catch {
    /* the bell is a courtesy */
  }
}

/** Whether one person sees one notification: not their own action, and only their clients' items unless they own the workspace. */
export function visibleTo(n: Pick<Notification, "owner_id" | "actor_id">, userId: string, isOwner: boolean): boolean {
  if (n.actor_id && n.actor_id === userId) return false;
  return isOwner || !n.owner_id || n.owner_id === userId;
}

export async function bellFor(d: NotifyDeps, user: { id: string; isOwner: boolean }, now: Date = new Date()): Promise<{ items: BellItem[]; unread: number }> {
  const since = now.getTime() - BELL_DAYS * 86_400_000;
  const rows = (await d.repo.listRecent(BELL_LIMIT * 2)).filter((n) => Date.parse(n.created_at) >= since && visibleTo(n, user.id, user.isOwner)).slice(0, BELL_LIMIT);
  const items = rows.map((n) => ({ id: n.id, kind: n.kind, title: n.title, detail: n.detail, href: n.href, at: n.created_at, unread: !n.read_by.includes(user.id) }));
  return { items, unread: items.filter((i) => i.unread).length };
}

export async function markRead(d: NotifyDeps, user: { id: string; isOwner: boolean }, ids: string[]): Promise<void> {
  const visible = new Set((await d.repo.listRecent(BELL_LIMIT * 4)).filter((n) => visibleTo(n, user.id, user.isOwner)).map((n) => n.id));
  const mine = ids.filter((id) => visible.has(id));
  if (mine.length) await d.repo.markRead(mine, user.id);
}

export async function markAllRead(d: NotifyDeps, user: { id: string; isOwner: boolean }): Promise<void> {
  const { items } = await bellFor(d, user);
  const unread = items.filter((i) => i.unread).map((i) => i.id);
  if (unread.length) await d.repo.markRead(unread, user.id);
}

/** "5 min ago", "2 h ago", "Nov 3". */
export function ago(iso: string, now: Date = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  if (mins < 7 * 24 * 60) return `${Math.round(mins / 1440)} d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(iso));
}
