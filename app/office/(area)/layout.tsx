import Link from "next/link";
import { signOut } from "@/lib/auth-actions";
import { requireOffice } from "@/lib/office/server";
import { FEATURES, ROLE_LABEL } from "@/lib/office/permissions.ts";
import { chooseOfficeAction } from "../actions";

// The office area's frame: the office, who's signed in, and the menu. Items the member can't use aren't shown; items
// that arrive with a later Phase 3 piece are shown as "Soon".
export default async function OfficeArea({ children }: { children: React.ReactNode }) {
  const ctx = await requireOffice();
  const mine = new Set(ctx.features.map((f) => f.key));
  const menu = FEATURES.filter((f) => mine.has(f.key) && f.level !== "bureau" && f.key !== "office.dashboard");
  return (
    <div className="office-shell">
      <header className="office-top">
        <div className="office-brand"><b>{ctx.office.name}</b><span>{ROLE_LABEL[ctx.role]} · {ctx.email}</span></div>
        <div className="office-top-actions">
          {ctx.bureau && ctx.offices.length > 1 && (
            <form action={chooseOfficeAction} className="office-switch">
              <select name="office_id" defaultValue={ctx.office.id} aria-label="Office">{ctx.offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
              <button className="monarch-secondary efin-small">Open</button>
            </form>
          )}
          {ctx.bureau && <Link className="monarch-secondary efin-small" href="/">Bureau admin</Link>}
          <form action={signOut}><button className="monarch-secondary efin-small">Sign out</button></form>
        </div>
      </header>
      <nav className="office-nav" aria-label="Office menu">
        {menu.map((f) => (f.status === "live" && f.href
          ? <Link key={f.key} href={f.href}>{f.label}</Link>
          : <span key={f.key} className="is-soon" title={f.note}>{f.label} <small>Soon</small></span>))}
      </nav>
      <main className="office-main">{children}</main>
    </div>
  );
}
