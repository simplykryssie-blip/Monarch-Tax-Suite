// Where the platform's own admin area may be opened from.
//
// The platform admin has its own address (ADMIN_HOSTS, e.g. admin.verexahq.com). When ADMIN_HOSTS is set the areas are
// separated: /admin pages are served only on that address, and that address serves nothing else. When it is not set
// (today's production) nothing changes: the rules below always allow, so merging this code alone changes no behavior.

type Env = Record<string, string | undefined>;

const clean = (raw: string | null | undefined): string | null => {
  const v = (raw ?? "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/.test(v) ? v : null;
};

/** The configured admin hostnames (empty when the separation is not switched on). */
export function adminHosts(env: Env = process.env): string[] {
  return (env.ADMIN_HOSTS ?? "").split(",").map((h) => clean(h)).filter((h): h is string => Boolean(h));
}

export const adminSeparationOn = (env: Env = process.env) => adminHosts(env).length > 0;

export function isAdminHost(rawHost: string | null | undefined, env: Env = process.env): boolean {
  const host = clean(rawHost);
  return Boolean(host) && adminHosts(env).includes(host!);
}

/** Pages the admin address may serve besides /admin itself: the sign-in steps an administrator needs. */
const ADMIN_HOST_OPEN = ["/login", "/forgot-password", "/reset-password"];
const underPrefix = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export type RouteVerdict = { action: "allow" } | { action: "deny"; status: 403 | 404; message: string } | { action: "redirect"; to: string };

/**
 * What to do with a request, from its host and path alone, so the proxy can decide before anything else.
 *   - Separation off: allow everything.
 *   - On an admin address: only /admin and the sign-in pages; the root goes to the admin home; everything else is 404.
 *   - On any other address: /admin is denied (403), never merely hidden.
 */
export function adminRouteVerdict(rawHost: string | null | undefined, pathname: string, env: Env = process.env): RouteVerdict {
  if (!adminSeparationOn(env)) return { action: "allow" };
  if (isAdminHost(rawHost, env)) {
    if (underPrefix(pathname, "/admin") || ADMIN_HOST_OPEN.some((p) => underPrefix(pathname, p))) return { action: "allow" };
    if (pathname === "/") return { action: "redirect", to: "/admin/workspaces" };
    // Framework and API internals that the admin pages themselves call.
    if (pathname.startsWith("/_next/") || pathname === "/favicon.ico") return { action: "allow" };
    return { action: "deny", status: 404, message: "Not found" };
  }
  if (underPrefix(pathname, "/admin")) return { action: "deny", status: 403, message: "The platform admin is not available at this address." };
  return { action: "allow" };
}

/** Whether a Monarch-workspace member role may use the workspace (staff may not). */
export const WORKSPACE_ROLES = ["owner", "admin"] as const;
export const roleOpensWorkspace = (role: string | null | undefined) => (WORKSPACE_ROLES as readonly string[]).includes(role ?? "");
