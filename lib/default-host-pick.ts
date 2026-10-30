// The default public address of a workspace: <name>.<platform site domain>. Pure, so it can be tested.

const LABEL = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;

/** The address for a workspace name, or null if the name can't be a valid single label or is one the platform keeps. */
export function defaultHostFor(slug: string | null | undefined, domain: string, reserved: ReadonlySet<string> = new Set()): string | null {
  const v = (slug ?? "").trim().toLowerCase();
  if (!LABEL.test(v) || v.includes("--") || reserved.has(v)) return null;
  return `${v}.${domain}`;
}

/** The workspace name in a default address, or null when the host is not a single label under the platform domain. */
export function labelOfDefaultHost(host: string, domain: string, reserved: ReadonlySet<string> = new Set()): string | null {
  const h = host.trim().toLowerCase().replace(/:\d+$/, "");
  if (!h.endsWith(`.${domain}`)) return null;
  const label = h.slice(0, -(domain.length + 1));
  return label.includes(".") || reserved.has(label) || !LABEL.test(label) || label.includes("--") ? null : label;
}
