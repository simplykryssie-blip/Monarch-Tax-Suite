import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ago, bellFor, markAllRead, markRead, raise, visibleTo, type NotifyDeps } from "../lib/notifications/service.ts";
import { KINDS, type Notification, type NotificationsRepo } from "../lib/notifications/types.ts";
import { appointmentNotice } from "../lib/appointments/activity.ts";
import { documentDeclinedNotice, documentOpenedNotice, documentSignedNotice } from "../lib/documents/activity.ts";
import { portalUploadNotice } from "../lib/portal/activity.ts";
import { formSubmittedNotice } from "../lib/forms/activity.ts";
import { invoicePaidNotification } from "../lib/workspace/invoice-notice.ts";
import type { Appointment, AppointmentType } from "../lib/appointments/types.ts";
import type { Delivery, LibraryDocument, SignatureRequest } from "../lib/documents/types.ts";

class MemoryNotifications implements NotificationsRepo {
  rows: Notification[] = [];
  now = () => "2026-10-20T12:00:00.000Z";
  async insert(n: Omit<Notification, "id" | "tenant_id" | "read_by" | "created_at">) {
    if (n.dedupe_key && this.rows.some((r) => r.dedupe_key === n.dedupe_key)) return false;
    this.rows.unshift({ ...n, id: randomUUID(), tenant_id: "t", read_by: [], created_at: this.now() });
    return true;
  }
  async listRecent(limit: number) { return this.rows.slice(0, limit).map((r) => ({ ...r })); }
  async markRead(ids: string[], userId: string) { for (const r of this.rows) if (ids.includes(r.id) && !r.read_by.includes(userId)) r.read_by.push(userId); }
}
const setup = () => { const repo = new MemoryNotifications(); const deps: NotifyDeps = { repo }; return { repo, deps }; };
const NOW = new Date("2026-10-20T12:30:00.000Z");
const ME = { id: "u-me", isOwner: true };

test("a notification shows on the bell until its reader opens it, and each person's read state is their own", async () => {
  const { deps } = setup();
  await raise(deps, { kind: KINDS.formSubmitted, title: "Jane submitted Intake", href: "/forms/f1/submissions/s1" });
  await raise(deps, { kind: KINDS.invoicePaid, title: "Bob paid invoice 1001", href: "/workspace/clients/c1?tab=billing" });
  let bell = await bellFor(deps, ME, NOW);
  assert.equal(bell.unread, 2);
  await markRead(deps, ME, [bell.items[0].id]);
  bell = await bellFor(deps, ME, NOW);
  assert.equal(bell.unread, 1);
  assert.equal((await bellFor(deps, { id: "u-other", isOwner: true }, NOW)).unread, 2, "someone else still has both unread");
  await markAllRead(deps, ME);
  assert.equal((await bellFor(deps, ME, NOW)).unread, 0);
});

test("the same event is reported once, a bad one is ignored, and a problem never reaches the caller", async () => {
  const { repo, deps } = setup();
  const n = { kind: KINDS.documentSigned, title: "Jane signed it", href: "/documents/d1?tab=sent", dedupeKey: "document:signed:r1" };
  await raise(deps, n); await raise(deps, n);
  assert.equal(repo.rows.length, 1);
  await raise(deps, { kind: "x", title: "   ", href: "/x" });
  await raise(deps, { kind: "x", title: "Outside", href: "https://elsewhere.test/" });
  assert.equal(repo.rows.length, 1, "no title and no outside links");
  const broken: NotifyDeps = { repo: { ...repo, insert: async () => { throw new Error("db down"); } } as unknown as NotificationsRepo };
  await raise(broken, { kind: "x", title: "Fine", href: "/x" }); // does not throw
});

test("who sees what: not your own action, only your clients unless you own the workspace, nothing older than 30 days", async () => {
  assert.equal(visibleTo({ owner_id: null, actor_id: "u1" }, "u1", true), false);
  assert.equal(visibleTo({ owner_id: null, actor_id: "u1" }, "u2", true), true);
  assert.equal(visibleTo({ owner_id: "u2", actor_id: null }, "u3", false), false);
  assert.equal(visibleTo({ owner_id: "u2", actor_id: null }, "u2", false), true);
  assert.equal(visibleTo({ owner_id: "u2", actor_id: null }, "u3", true), true);
  const { repo, deps } = setup();
  repo.now = () => "2026-09-01T00:00:00.000Z";
  await raise(deps, { kind: "x", title: "Old news", href: "/x" });
  repo.now = () => "2026-10-20T12:00:00.000Z";
  await raise(deps, { kind: "x", title: "Fresh", href: "/x" });
  assert.deepEqual((await bellFor(deps, ME, NOW)).items.map((i) => i.title), ["Fresh"]);
  // Marking something read that you can't see does nothing.
  await raise(deps, { kind: "x", title: "Theirs", href: "/x", ownerId: "u2" });
  const theirs = repo.rows.find((r) => r.title === "Theirs")!;
  await markRead(deps, { id: "u9", isOwner: false }, [theirs.id]);
  assert.deepEqual(theirs.read_by, []);
});

test("times read the way people say them", () => {
  assert.equal(ago("2026-10-20T12:29:40.000Z", NOW), "just now");
  assert.equal(ago("2026-10-20T12:00:00.000Z", NOW), "30 min ago");
  assert.equal(ago("2026-10-20T09:30:00.000Z", NOW), "3 h ago");
  assert.equal(ago("2026-10-17T12:30:00.000Z", NOW), "3 d ago");
  assert.equal(ago("2026-09-01T12:00:00.000Z", NOW), "Sep 1");
});

const type = { id: "ty", name: "Tax prep consultation" } as AppointmentType;
const appt = { id: "a1", client_id: "c1", contact_name: "Jane Smith", starts_at: "2026-11-03T19:00:00.000Z", office_time_zone: "America/Chicago", cancel_reason: "Plans changed", updated_at: "2026-10-20T12:00:00Z" } as Appointment;

test("appointment wording: booked, moved and cancelled, by the client or by staff", () => {
  const booked = appointmentNotice({ kind: "booked", appointment: appt, type, by: "client" });
  assert.equal(booked.title, "Jane Smith booked Tax prep consultation");
  assert.match(booked.detail!, /Tuesday, November 3 at 1:00 PM/);
  assert.equal(booked.href, "/calendar?view=day&date=2026-11-03");
  assert.equal(booked.actorId, null);
  const moved = appointmentNotice({ kind: "rescheduled", appointment: appt, type, by: "client", from: "2026-11-02T19:00:00.000Z" });
  assert.equal(moved.title, "Jane Smith moved Tax prep consultation");
  assert.match(moved.detail!, /Monday, November 2 at 1:00 PM CST → Tuesday, November 3 at 1:00 PM CST/);
  const cancelled = appointmentNotice({ kind: "cancelled", appointment: appt, type, by: "staff", actorId: "u1" });
  assert.equal(cancelled.title, "Tax prep consultation cancelled for Jane Smith");
  assert.match(cancelled.detail!, /Plans changed/);
  assert.equal(cancelled.actorId, "u1", "the person who did it isn't told");
  assert.notEqual(appointmentNotice({ kind: "booked", appointment: appt, type, by: "client" }).dedupeKey, appointmentNotice({ kind: "cancelled", appointment: appt, type, by: "client" }).dedupeKey);
});

test("document, upload, form and invoice wording points at the right place", () => {
  const doc = { id: "d1", name: "Engagement letter" } as LibraryDocument;
  const toClient = { id: "dl1", client_id: "c1", recipient_name: "Jane Smith", recipient_email: "j@x.test" } as Delivery;
  const toOther = { id: "dl2", client_id: null, recipient_name: null, recipient_email: "k@x.test" } as Delivery;
  const sig = { id: "s1", signed_name: "Jane Q Smith", signer_name: "Jane", decline_reason: "Wrong year" } as SignatureRequest;
  assert.equal(documentOpenedNotice(toClient, doc).href, "/workspace/clients/c1?tab=documents");
  assert.equal(documentOpenedNotice(toOther, doc).href, "/documents/d1?tab=sent");
  assert.equal(documentOpenedNotice(toOther, doc).title, "k@x.test opened Engagement letter");
  assert.equal(documentSignedNotice(toClient, doc, sig).title, "Jane Q Smith signed Engagement letter");
  assert.equal(documentDeclinedNotice(toClient, doc, sig).detail, "Wrong year");
  const asked = portalUploadNotice({ id: "c1", full_name: "Jane Smith" }, { id: "x1", title: "W-2 2025", request_id: "r1" });
  assert.equal(asked.kind, KINDS.portalRequestDone);
  assert.equal(portalUploadNotice({ id: "c1", full_name: "Jane Smith" }, { id: "x2", title: "ID" }).kind, KINDS.portalUpload);
  assert.equal(formSubmittedNotice({ id: "f1", name: "Intake" }, { id: "s1", respondent_name: null, respondent_email: "a@b.test" }).title, "a@b.test submitted Intake");
  const paid = invoicePaidNotification({ id: "i1", number: "1001", client_id: "c1", total_cents: 25000 }, "Jane Smith");
  assert.equal(paid.title, "Jane Smith paid invoice 1001");
  assert.equal(paid.detail, "$250.00");
});
