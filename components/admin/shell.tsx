"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/lib/auth-actions";
import { Icon, type IconName } from "./icons";
import { BrandMark, Wordmark } from "./brand";

type Leaf = { label: string; icon: IconName; href?: string };
type Branch = { label: string; icon: IconName; items: (Leaf | Branch)[] };
type Entry = Leaf | Branch;
const isBranch = (e: Entry): e is Branch => "items" in e;

// Without a live data source an item is shown but not linked ("Soon"), so nothing presents placeholder content as real.
const NAV: Entry[] = [
  {
    label: "My Office",
    icon: "office",
    items: [
      { label: "Dashboard", icon: "dashboard", href: "/" },
      { label: "Firms", icon: "firms" },
      {
        label: "My Store",
        icon: "store",
        items: [
          { label: "Customers", icon: "customers", href: "/customers" },
          { label: "Orders", icon: "orders", href: "/orders" },
          { label: "Products", icon: "products", href: "/products" },
          { label: "Licenses", icon: "licenses", href: "/licenses" },
          { label: "Installations", icon: "installs", href: "/installations" },
          { label: "Courses", icon: "courses" },
          { label: "Memberships", icon: "members" },
        ],
      },
    ],
  },
  {
    label: "Operations",
    icon: "automation",
    items: [
      { label: "Automation", icon: "automation", href: "/automation" },
      { label: "Support", icon: "support" },
      { label: "Marketing", icon: "marketing" },
      { label: "Reports", icon: "reports" },
      { label: "Settings", icon: "settings" },
    ],
  },
];

const hrefs = (e: Entry): string[] => (isBranch(e) ? e.items.flatMap(hrefs) : e.href ? [e.href] : []);
const matches = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

function crumb(pathname: string): string {
  for (const top of NAV) {
    const trail: string[] = [];
    const walk = (e: Entry, path: string[]): boolean => {
      if (isBranch(e)) return e.items.some((c) => walk(c, [...path, e.label]));
      if (e.href && matches(pathname, e.href)) {
        trail.push(...path, e.label);
        return true;
      }
      return false;
    };
    if (walk(top, [])) return trail.join("  /  ");
  }
  return "Monarch Tax Suite";
}

function Group({ entry, depth, pathname, open, toggle, close }: { entry: Entry; depth: number; pathname: string; open: Record<string, boolean>; toggle: (k: string) => void; close: () => void }) {
  if (!isBranch(entry)) {
    if (!entry.href) {
      return (
        <span className="mt-nav is-soon" aria-disabled="true" title="Coming soon" style={{ paddingLeft: 14 + depth * 14 }}>
          <Icon name={entry.icon} size={18} />
          <span>{entry.label}</span>
          <em>Soon</em>
        </span>
      );
    }
    const active = matches(pathname, entry.href);
    return (
      <Link href={entry.href} onClick={close} className={"mt-nav" + (active ? " is-active" : "")} aria-current={active ? "page" : undefined} style={{ paddingLeft: 14 + depth * 14 }}>
        <Icon name={entry.icon} size={18} />
        <span>{entry.label}</span>
      </Link>
    );
  }
  const containsActive = entry.items.some((c) => hrefs(c).some((h) => matches(pathname, h)));
  const key = entry.label;
  const expanded = open[key] ?? true;
  return (
    <div className={"mt-group depth-" + depth}>
      <button type="button" className={"mt-group-head" + (containsActive ? " has-active" : "")} onClick={() => toggle(key)} aria-expanded={expanded} style={{ paddingLeft: 14 + depth * 14 }}>
        <Icon name={entry.icon} size={depth === 0 ? 19 : 18} />
        <span>{entry.label}</span>
        <i className={"mt-caret" + (expanded ? " is-open" : "")}><Icon name="chevron" size={14} /></i>
      </button>
      {expanded && (
        <div className="mt-group-body">
          {entry.items.map((c) => <Group key={c.label} entry={c} depth={depth + 1} pathname={pathname} open={open} toggle={toggle} close={close} />)}
        </div>
      )}
    </div>
  );
}

export function AdminShell({ email, logoSrc, children }: { email: string; logoSrc?: string | null; children: React.ReactNode }) {
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  // Every section starts open; the owner can collapse any of them.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !(o[key] ?? true) }));
  const initial = (email[0] ?? "M").toUpperCase();

  return (
    <div className="mt-shell">
      <aside className={"mt-sidebar" + (menu ? " is-open" : "")}>
        <Link href="/" className="mt-brand" onClick={() => setMenu(false)} aria-label="Monarch Tax Suite home">
          <BrandMark src={logoSrc} size={46} />
          <Wordmark />
        </Link>
        <nav className="mt-nav-scroll" aria-label="Main">
          {NAV.map((e) => <Group key={e.label} entry={e} depth={0} pathname={pathname} open={open} toggle={toggle} close={() => setMenu(false)} />)}
        </nav>
        <div className="mt-user">
          <div className="mt-avatar">{initial}</div>
          <div>
            <b>Administrator</b>
            <small>{email}</small>
          </div>
        </div>
      </aside>
      {menu && <button className="mt-scrim" onClick={() => setMenu(false)} aria-label="Close menu" />}
      <main className="mt-main">
        <header className="mt-topbar">
          <button className="mt-hamburger" onClick={() => setMenu(!menu)} aria-label="Open menu"><Icon name="menu" size={22} /></button>
          <div className="mt-crumb">{crumb(pathname)}</div>
          <form action={signOut}>
            <button type="submit" className="mt-signout"><Icon name="signout" size={16} /><span>Sign out</span></button>
          </form>
        </header>
        <div className="mt-content">
          {children}
          <footer className="mt-footer"><b>MONARCH TAX SUITE</b><span>Admin workspace · live data</span></footer>
        </div>
      </main>
    </div>
  );
}
