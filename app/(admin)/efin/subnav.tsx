"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SUBNAV = [
  { href: "/efin", label: "Dashboard" },
  { href: "/efin/list", label: "EROs & EFINs" },
  { href: "/efin/renewals", label: "Renewals" },
  { href: "/efin/history", label: "History" },
];

export function SubNav() {
  const path = usePathname();
  const on = (href: string) => (href === "/efin" ? path === "/efin" : href === "/efin/list" ? path === "/efin/list" || path === "/efin/new" || path === "/efin/add" || path.startsWith("/efin/org/") || path.startsWith("/efin/locations/") || path.startsWith("/efin/documents/") || /^\/efin\/[0-9a-f-]{36}/.test(path) : path.startsWith(href));
  return (
    <nav className="mt-seg efin-subnav" aria-label="My Service Bureau sections">
      {SUBNAV.map((s) => <Link key={s.href} href={s.href} className={on(s.href) ? "is-on" : ""}>{s.label}</Link>)}
    </nav>
  );
}
