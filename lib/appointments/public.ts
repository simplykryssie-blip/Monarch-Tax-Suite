import "server-only";
import { headers } from "next/headers";
import { clientAddress, hashClient } from "../commerce/rate-limit.ts";
import { ValidationError } from "../commerce/validation.ts";
import { rateLimitStore } from "../rate-limit-server";
import { requestTenant } from "../wisp/server";
import { appointmentDeps } from "./server";

/** The office whose web address the booking page was opened on, and its calendar. */
export async function bookingContext() {
  const tenantId = await requestTenant();
  return { tenantId, deps: appointmentDeps(tenantId) };
}

/** Limits per visitor and per office, in fixed windows. A visitor's address is only ever stored as a keyed hash. */
export async function bookingVisitor(tenantId: string, kind: "book" | "change"): Promise<void> {
  const h = await headers();
  const ip = clientAddress(h.get("x-forwarded-for"));
  const ipHash = ip ? hashClient(ip, process.env.MONARCH_ENCRYPTION_KEY) : null;
  const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
  const store = rateLimitStore();
  const over = async (bucket: string, limit: number) => (await store.hit(bucket, hour).catch(() => 0)) > limit;
  const limits = { book: { ip: 8, office: 400 }, change: { ip: 20, office: 800 } }[kind];
  if (ipHash && (await over(`booking:${kind}:ip:${ipHash}:${tenantId}`, limits.ip))) throw new ValidationError("Too many attempts from your connection. Please wait a while and try again.");
  if (await over(`booking:${kind}:office:${tenantId}`, limits.office)) throw new ValidationError("Booking is very busy right now. Please try again in a few minutes.");
}
