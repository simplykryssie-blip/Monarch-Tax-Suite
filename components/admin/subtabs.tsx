"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** A row of page sub-tabs. The first is active only on its own address; the others also on pages beneath them. */
export function SubTabs({ tabs, label }: { tabs: readonly (readonly [string, string])[]; label: string }) {
  const path = usePathname();
  return (
    <nav className="subtabs" aria-label={label}>
      {tabs.map(([href, text], i) => {
        const on = i === 0 ? path === href : path === href || path.startsWith(`${href}/`);
        return <Link key={href} href={href} className={"subtab" + (on ? " is-on" : "")} aria-current={on ? "page" : undefined}>{text}</Link>;
      })}
    </nav>
  );
}
