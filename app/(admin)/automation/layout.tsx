import Link from "next/link";
import { requireAdmin } from "@/lib/admin";

const TABS = [["/automation", "Overview"], ["/automation/workflows", "Workflows"], ["/automation/templates", "Email templates"], ["/automation/activity", "Activity"], ["/automation/settings", "Settings"]] as const;

export default async function AutomationLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <>
      <nav className="monarch-page-actions" aria-label="Automation Center" style={{ gap: 18, justifyContent: "flex-start", flexWrap: "wrap" }}>
        {TABS.map(([href, text]) => <Link key={href} href={href} className="monarch-link">{text}</Link>)}
      </nav>
      {children}
    </>
  );
}
