"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/lib/auth-actions";
import { Icon, type IconName } from "./icons";
import { BrandMark, Wordmark } from "./brand";
import { CommandPalette } from "./command-palette";

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
      { label: "Home", icon: "dashboard", href: "/" },
      { label: "Firms", icon: "firms" },
      {
        label: "EFIN Management",
        icon: "licenses",
        items: [
          { label: "Registry", icon: "licenses", href: "/efin" },
          { label: "Offices", icon: "office", href: "/efin/offices" },
          { label: "People", icon: "user", href: "/efin/people" },
          { label: "Assignments", icon: "check", href: "/efin/assignments" },
          { label: "Renewals", icon: "bell", href: "/efin/renewals" },
          { label: "History", icon: "reports", href: "/efin/history" },
        ],
      },
      {
        label: "My Store",
        icon: "store",
        items: [
          { label: "Dashboard", icon: "reports", href: "/store" },
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

export type Alert = { title: string; note: string; href: string; count: number };

/** A dropdown that closes on outside click or Escape. `trigger` renders the button; children render the panel. */
function Popover({ trigger, children }: { trigger: (open: boolean, toggle: () => void) => React.ReactNode; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", click);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className="mt-pop-wrap" ref={ref}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && children(() => setOpen(false))}
    </div>
  );
}

export function AdminShell({ email, logoSrc, today, alerts = [], children }: { email: string; logoSrc?: string | null; today: string; alerts?: Alert[]; children: React.ReactNode }) {
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  // Every section starts open; the owner can collapse any of them.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !(o[key] ?? true) }));
  useEffect(() => {
    if (!menu) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [menu]);
  const initial = (email[0] ?? "M").toUpperCase();
  const attention = alerts.filter((a) => a.count > 0);
  const total = attention.reduce((n, a) => n + a.count, 0);

  return (
    <div className="mt-shell">
      <aside className={"mt-sidebar" + (menu ? " is-open" : "")} aria-hidden={!menu} id="mt-flyout">
        <Link href="/" className="mt-brand" onClick={() => setMenu(false)} aria-label="Monarch Tax Suite home">
          <span className="mt-brand-plate">
            {logoSrc ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="mt-logo-full" src={logoSrc} alt="Monarch Tax Suite" width={1000} height={253} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="mt-logo-small" src="/brand/mark.png" alt="" width={420} height={282} />
              </>
            ) : (
              <>
                <BrandMark size={46} />
                <Wordmark />
              </>
            )}
          </span>
        </Link>
        <nav className="mt-nav-scroll" aria-label="Main">
          {NAV.map((e) => <Group key={e.label} entry={e} depth={0} pathname={pathname} open={open} toggle={toggle} close={() => setMenu(false)} />)}
        </nav>
        <div className="mt-chess" aria-hidden="true"><span>STRATEGY</span><span>GROWTH</span><span>LEGACY</span></div>
      </aside>
      {menu && <button className="mt-scrim" onClick={() => setMenu(false)} aria-label="Close menu" />}
      <main className="mt-main">
        <header className="mt-topbar">
          <button className="mt-hamburger" onClick={() => setMenu(!menu)} aria-label={menu ? "Close menu" : "Open menu"} aria-expanded={menu}><Icon name="menu" size={22} /></button>
          <div className="mt-crumb">{crumb(pathname)}</div>
          <CommandPalette />
          <span className="mt-date">{today}</span>
          <Link href="/orders/internal" className="mt-new"><Icon name="plus" size={15} /><span>New license</span></Link>

          <Popover
            trigger={(open, toggle) => (
              <button type="button" className="mt-iconbtn" onClick={toggle} aria-label={total ? `${total} items need attention` : "Notifications"} aria-expanded={open}>
                <Icon name="bell" size={19} />
                {total > 0 && <i className="mt-dot" />}
              </button>
            )}
          >
            {(close) => (
              <div className="mt-pop" role="menu">
                <div className="mt-pop-title">Needs your attention</div>
                {attention.length === 0 ? <p className="mt-pop-empty">You are all caught up.</p> : attention.map((a) => (
                  <Link key={a.title} href={a.href} onClick={close} className="mt-pop-item" role="menuitem">
                    <span><b>{a.title}</b><small>{a.note}</small></span>
                    <span className="mt-pill is-hot">{a.count}</span>
                  </Link>
                ))}
              </div>
            )}
          </Popover>

          <Popover
            trigger={(open, toggle) => (
              <button type="button" className="mt-chip" onClick={toggle} aria-expanded={open} aria-label="Account menu">
                <div className="mt-avatar">{initial}</div>
                <div><b>Administrator</b><small>Owner</small></div>
                <Icon name="chevron" size={13} />
              </button>
            )}
          >
            {() => (
              <div className="mt-pop is-narrow" role="menu">
                <div className="mt-pop-title">{email}</div>
                <Link href="/reset-password" className="mt-pop-item" role="menuitem"><span><b>Change password</b></span><Icon name="licenses" size={16} /></Link>
                <form action={signOut}>
                  <button type="submit" className="mt-pop-item" role="menuitem"><span><b>Sign out</b></span><Icon name="signout" size={16} /></button>
                </form>
              </div>
            )}
          </Popover>
        </header>
        <div className="mt-content">
          {children}
          <footer className="mt-footer"><b>MONARCH TAX SUITE</b><span>Admin workspace · live data</span></footer>
        </div>
      </main>
    </div>
  );
}
