"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Automation's parts: the automatic messages (with their wording) and the pictures they use. */
const TABS = [
  { href: "/automation/workflows", label: "Automatic messages", match: ["/automation/workflows", "/automation/templates"] },
  { href: "/automation/images", label: "Pictures", match: ["/automation/images"] },
];

export function AutomationTabs() {
  const path = usePathname();
  return (
    <nav className="sx-tabs" aria-label="Automation">
      {TABS.map((t) => {
        const on = t.match.some((m) => path === m || path.startsWith(`${m}/`));
        return <Link key={t.href} href={t.href} className={on ? "is-on" : undefined} aria-current={on ? "page" : undefined}>{t.label}</Link>;
      })}
    </nav>
  );
}
