// Which web address a workspace's public pages (booking, appointment links) are reached on. Pure, so it can be tested.
// A public page finds its workspace from the address it was opened on, so a link must carry the workspace's own address:
// the app's own address would open Monarch's pages, not theirs.

export type SiteHost = { hostname: string; kind: "subdomain" | "custom"; status: string };

export function pickPublicOrigin(input: { production: boolean; brandLinkHost: string | null; siteHosts: SiteHost[]; defaultHost?: string | null; isMonarch: boolean; appOrigin: string }): string | null {
  // Production: the firm's own link address, when it has exactly one brand with one (unchanged for Monarch).
  if (input.production && input.brandLinkHost) return `https://${input.brandLinkHost}`;
  // Monarch's own address is the app's, as it has always been.
  if (input.isMonarch) return input.appOrigin;
  // Anyone else: their website address (their own domain first, else the one made with the website, else the default every workspace has).
  const active = input.siteHosts.filter((h) => h.status === "active");
  const host = active.find((h) => h.kind === "custom") ?? active.find((h) => h.kind === "subdomain");
  if (host) return `https://${host.hostname}`;
  // No website yet: the address every workspace has from the day it is created.
  return input.defaultHost ? `https://${input.defaultHost}` : null;
}
