import { requirePlatformAdmin } from "@/lib/admin";

// Everything under /admin is Verexa HQ's own tooling. Only a platform administrator can open it: a workspace's account never
// can, whatever its tier. (Each page and action checks again; this stops a page that forgets to.)
export default async function AdminAreaLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();
  return <>{children}</>;
}
