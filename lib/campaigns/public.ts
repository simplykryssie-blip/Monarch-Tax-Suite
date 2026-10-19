import "server-only";
import { campaignDeps, recipientById, recipientByToken, type FoundRecipient } from "./server";
import { unsubscribeRecipient } from "./service.ts";

// What the links in a campaign message do. The token in the link is the credential; it names one recipient, and from there
// everything runs as that recipient's office.

const ONE_PIXEL_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
export const trackingPixel = () => new Response(ONE_PIXEL_GIF, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0", "Content-Length": String(ONE_PIXEL_GIF.length) } });

export async function noteOpen(token: string): Promise<void> {
  const r = await recipientByToken(token).catch(() => null);
  if (r && r.channel === "email") await campaignDeps(r.tenant_id).repo.countOpen(r.id).catch(() => undefined);
}

/** Counts the click and returns where to send the reader, or null when the link is unknown. */
export async function clickTarget(token: string, position: number): Promise<string | null> {
  if (!Number.isInteger(position) || position < 0 || position > 99) return null;
  const r = await recipientByToken(token).catch(() => null);
  if (!r) return null;
  const repo = campaignDeps(r.tenant_id).repo;
  const link = (await repo.listLinks(r.campaign_id)).find((l) => l.position === position);
  if (!link || !/^https:\/\//.test(link.url)) return null;
  await repo.countClick(r.id, r.campaign_id, position).catch(() => undefined);
  return link.url;
}

export async function unsubscribeByToken(token: string): Promise<FoundRecipient | null> {
  const r = await recipientByToken(token);
  if (!r || r.channel !== "email") return null;
  await unsubscribeRecipient(campaignDeps(r.tenant_id), r);
  return r;
}

export { recipientById, recipientByToken };
