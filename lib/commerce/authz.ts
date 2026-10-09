export type AuthUser = { id: string; email?: string | null } | null;

export type AdminDecision = { allowed: true; userId: string } | { allowed: false; reason: "unauthenticated" | "forbidden" };

/**
 * Server-side administrator check. `isAdmin` consults the admin_users table
 * with the service role; nothing in the browser can grant admin access.
 */
export async function decideAdmin(user: AuthUser, isAdmin: (userId: string) => Promise<boolean>): Promise<AdminDecision> {
  if (!user?.id) return { allowed: false, reason: "unauthenticated" };
  return (await isAdmin(user.id)) ? { allowed: true, userId: user.id } : { allowed: false, reason: "forbidden" };
}
