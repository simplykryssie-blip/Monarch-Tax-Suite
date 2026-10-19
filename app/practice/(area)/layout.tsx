import Link from "next/link";
import { signOut } from "@/lib/auth-actions";
import { billingView } from "@/lib/billing/view.ts";
import { requirePractice } from "@/lib/practice/server";

// The independent PTIN holder's frame: the workspace, who's signed in, and the menu. The working screens (My Clients,
// Prep work, Assigned returns, WISP) are added to the menu as they arrive.
export default async function PracticeArea({ children }: { children: React.ReactNode }) {
  const ctx = await requirePractice();
  const banner = billingView(ctx.subscription)?.banner ?? null;
  return (
    <div className="office-shell">
      <header className="office-top">
        <div className="office-brand"><b>{ctx.workspace}</b><span>PTIN holder · {ctx.email}</span></div>
        <div className="office-top-actions">
          <form action={signOut}><button className="monarch-secondary efin-small">Sign out</button></form>
        </div>
      </header>
      <nav className="office-nav" aria-label="Workspace menu">
        <Link href="/practice">Home</Link>
        <Link href="/practice/clients">My Clients</Link>
        <Link href="/practice/prep">Prep work</Link>
        <Link href="/practice/assigned">Assigned returns</Link>
        <Link href="/practice/campaigns">Campaigns</Link>
        <Link href="/practice/website">Website</Link>
        <Link href="/practice/billing">Billing</Link>
        <Link href="/practice/security">Security</Link>
      </nav>
      <main className="office-main">
        {banner && <p className={banner.tone === "warn" ? "monarch-alert is-error" : "monarch-notice"} role="status">{banner.text} <Link href="/practice/billing">Billing</Link></p>}
        {children}
      </main>
    </div>
  );
}
