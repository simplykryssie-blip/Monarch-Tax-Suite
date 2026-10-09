"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/lib/auth-actions";

type NavItem = { label: string; icon: string; href?: string };

// Sections without a live data source are shown but not linked, so nothing
// presents placeholder content as real business records.
const GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "WORKSPACE", items: [{ label: "Dashboard", icon: "◫", href: "/" }, { label: "Customers", icon: "♙", href: "/customers" }, { label: "Orders", icon: "▤", href: "/orders" }] },
  { label: "COMMERCE", items: [{ label: "Products", icon: "◇", href: "/products" }, { label: "Courses & Programs", icon: "▱" }, { label: "Memberships", icon: "♧" }] },
  {
    label: "OPERATIONS",
    items: [
      { label: "Licenses", icon: "⌘", href: "/licenses" },
      { label: "Installations", icon: "⚑", href: "/installations" },
      { label: "Support", icon: "◎" },
      { label: "Marketing", icon: "↗" },
      { label: "Reports", icon: "▥" },
      { label: "Settings", icon: "⚙" },
    ],
  },
];

export function AdminShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <div className="monarch-shell">
      <aside className={"monarch-sidebar " + (open ? "is-open" : "")}>
        <div className="monarch-brand">
          <div className="monarch-crown">♛</div>
          <b>MONARCH</b>
          <span>TAX SUITE</span>
        </div>
        {GROUPS.map((group) => (
          <section className="monarch-nav-group" key={group.label}>
            <small>{group.label}</small>
            {group.items.map((item) =>
              item.href ? (
                <Link key={item.label} href={item.href} onClick={() => setOpen(false)} className={"monarch-nav " + (isActive(item.href) ? "chosen" : "")}>
                  <span>{item.icon}</span>
                  {item.label}
                </Link>
              ) : (
                <span key={item.label} className="monarch-nav is-disabled" aria-disabled="true" title="Not connected yet">
                  <span>{item.icon}</span>
                  {item.label}
                  <em>Soon</em>
                </span>
              ),
            )}
          </section>
        ))}
        <div className="monarch-user">
          <div className="monarch-avatar">M</div>
          <div>
            <b>Administrator</b>
            <small>{email}</small>
          </div>
        </div>
      </aside>
      {open && <button className="monarch-scrim" onClick={() => setOpen(false)} aria-label="Close menu" />}
      <main className="monarch-main">
        <header className="monarch-topbar">
          <button className="monarch-hamburger" onClick={() => setOpen(!open)} aria-label="Open menu">
            ☰
          </button>
          <div className="monarch-topbar-title">Monarch Tax Suite · Admin Workspace</div>
          <form action={signOut} className="monarch-signout">
            <button type="submit">Sign out</button>
          </form>
        </header>
        <div className="monarch-content">
          {children}
          <footer className="monarch-footer">
            <b>MONARCH TAX SUITE</b>
            <span>ADMIN WORKSPACE · LIVE DATA</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
