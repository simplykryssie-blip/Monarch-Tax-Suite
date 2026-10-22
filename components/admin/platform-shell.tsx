import Link from "next/link";
import { signOut } from "@/lib/auth-actions";
import { PLATFORM } from "@/lib/platform-brand";

// The frame for Verexa HQ's own admin (admin address). It is deliberately plain and separate from any workspace's
// shell: no workspace menu, brand or alerts appear in it. The menu is the list below; the later staff/support view
// (audited, time-limited access to a workspace) will be one more entry here, not built yet.
export const PLATFORM_MENU = [
  { href: "/admin/workspaces", label: "Workspaces" },
  { href: "/admin/billing-setup", label: "Billing setup" },
  { href: "/admin/integrations", label: "Integrations" },
  { href: "/admin/legal", label: "Legal & signup" },
  { href: "/admin/activity", label: "Activity" },
] as const;

export function PlatformShell({ email, children }: { email: string; children: React.ReactNode }) {
  return (
    <div className="office-shell">
      <header className="office-top">
        <div className="office-brand"><b>{PLATFORM.name} · Platform admin</b><span>{email}</span></div>
        <div className="office-top-actions">
          <form action={signOut}><button className="monarch-secondary efin-small">Sign out</button></form>
        </div>
      </header>
      <nav className="office-nav" aria-label="Platform admin menu">
        {PLATFORM_MENU.map((m) => <Link key={m.href} href={m.href}>{m.label}</Link>)}
      </nav>
      <main className="office-main">{children}</main>
    </div>
  );
}
