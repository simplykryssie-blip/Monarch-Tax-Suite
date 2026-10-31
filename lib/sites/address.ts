import type { DomainsPort } from "./service.ts";

// Every workspace address under the platform site domain (<name>.sites.verexahq.com) needs its own place on the hosting
// project, because the hosting side issues a certificate per address. This adds one when the address is made. It never
// blocks what the person was doing: a problem is logged and reported back, and the one-time catch-up covers anything missed.

export type Registration = "added" | "already" | "off" | "failed";

/**
 * Puts an address on the hosting project. `enabled` is true only on the live deployment, so a test deployment never touches the
 * live project's address list. Safe to repeat: an address already there is left alone.
 */
export async function registerAddress(port: DomainsPort | null, host: string | null | undefined, enabled: boolean): Promise<Registration> {
  if (!enabled || !port || !host) return "off";
  try {
    if (await port.check(host)) return "already";
    await port.add(host);
    return "added";
  } catch (e) {
    console.error(JSON.stringify({ event: "address_registration_failed", host, message: e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
    return "failed";
  }
}

/** Takes an address off the hosting project (after a rename). Best effort. */
export async function releaseAddress(port: DomainsPort | null, host: string | null | undefined, enabled: boolean): Promise<void> {
  if (!enabled || !port || !host) return;
  await port.remove(host).catch(() => undefined);
}
