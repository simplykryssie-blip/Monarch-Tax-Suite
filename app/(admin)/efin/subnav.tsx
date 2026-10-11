"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SUBNAV = [
  { href: "/efin", label: "Registry" },
  { href: "/efin/offices", label: "Offices" },
  { href: "/efin/people", label: "People" },
  { href: "/efin/assignments", label: "Assignments" },
  { href: "/efin/renewals", label: "Renewals" },
  { href: "/efin/history", label: "History" },
];

export function SubNav() {
  const path = usePathname();
  const on = (href: string) => (href === "/efin" ? path === "/efin" || path === "/efin/new" || /^\/efin\/[0-9a-f-]{36}/.test(path) : path.startsWith(href));
  return (
    <nav className="mt-seg efin-subnav" aria-label="EFIN Management sections">
      {SUBNAV.map((s) => <Link key={s.href} href={s.href} className={on(s.href) ? "is-on" : ""}>{s.label}</Link>)}
    </nav>
  );
}
