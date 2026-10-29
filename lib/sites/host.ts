import { isAdminHost } from "../admin-host.ts";
import { platformDomain, RESERVED_LABELS } from "./domains.ts";

// Which requests are for a website rather than for the application. Decided from the Host header alone, so the proxy
// can do it before anything else. Application hosts (the configured app address, the hosting platform's preview
// addresses, localhost) never serve a site; everything else is looked up.

export type HostKind = { kind: "app" } | { kind: "platform-subdomain"; host: string; label: string } | { kind: "other"; host: string };

export function cleanRequestHost(raw: string | null | undefined): string | null {
  const v = (raw ?? "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/.test(v) ? v : null;
}

export function classifyHost(rawHost: string | null | undefined, env: Record<string, string | undefined> = process.env): HostKind {
  const host = cleanRequestHost(rawHost);
  if (!host) return { kind: "app" };
  if (host === "localhost" || host.endsWith(".localhost") || /^\d+(\.\d+){3}$/.test(host)) return { kind: "app" };
  if (/(^|\.)(vercel\.app|vercel\.sh|vercel\.dev|now\.sh)$/.test(host)) return { kind: "app" };
  const configured = cleanRequestHost(safeHost(env.NEXT_PUBLIC_APP_URL));
  if (configured && host === configured) return { kind: "app" };
  if (isAdminHost(host, env)) return { kind: "app" };
  const extra = (env.APP_HOSTS ?? "").split(",").map((h) => cleanRequestHost(h)).filter(Boolean);
  if (extra.includes(host)) return { kind: "app" };
  const domain = platformDomain(env);
  if (host === domain) return { kind: "app" };
  if (host.endsWith(`.${domain}`)) {
    const label = host.slice(0, -(domain.length + 1));
    // Only a single label under the platform domain can be an office's address; reserved labels belong to the platform.
    if (label.includes(".") || RESERVED_LABELS.has(label)) return { kind: "app" };
    return { kind: "platform-subdomain", host, label };
  }
  return { kind: "other", host };
}

function safeHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** A public booking address such as book.yourfirm.com: its front page is the booking page. */
export function isBookingHost(rawHost: string | null | undefined): boolean {
  const host = cleanRequestHost(rawHost);
  return Boolean(host) && /^book\.[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host!);
}
