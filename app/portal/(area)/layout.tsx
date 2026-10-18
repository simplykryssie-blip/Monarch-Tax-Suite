import Link from "next/link";
import { signOut } from "@/lib/auth-actions";
import { requirePortal } from "@/lib/portal/server";
import { chooseOfficeAction } from "../actions";

// The client's frame: the office, who is signed in, and the menu. Items are added to the menu as each part arrives.
export default async function PortalArea({ children }: { children: React.ReactNode }) {
  const ctx = await requirePortal();
  return (
    <div className="office-shell">
      <header className="office-top">
        <div className="office-brand"><b>{ctx.office.name}</b><span>Client portal · {ctx.email}</span></div>
        <div className="office-top-actions">
          {ctx.offices.length > 1 && (
            <form action={chooseOfficeAction} className="portal-switch">
              <label htmlFor="office" className="monarch-muted">Office</label>
              <select id="office" name="office" defaultValue={ctx.tenantId}>{ctx.offices.map((o) => <option key={o.tenantId} value={o.tenantId}>{o.name}</option>)}</select>
              <button className="monarch-secondary efin-small">Switch</button>
            </form>
          )}
          <form action={signOut}><button className="monarch-secondary efin-small">Sign out</button></form>
        </div>
      </header>
      <nav className="office-nav" aria-label="Portal menu">
        <Link href="/portal">Home</Link>
        <Link href="/portal/documents">Documents</Link>
        <Link href="/portal/messages">Messages</Link>
        <Link href="/portal/security">Security</Link>
      </nav>
      <main className="office-main">{children}</main>
    </div>
  );
}
