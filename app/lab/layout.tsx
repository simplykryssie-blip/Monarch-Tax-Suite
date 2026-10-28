import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/lib/auth-actions";
import { labContext } from "@/lib/lab/server";
import "./lab.css";

export const metadata: Metadata = { title: { default: "Monarch Tax Lab", template: "%s | Monarch Tax Lab" }, robots: { index: false, follow: false } };

export default async function LabLayout({ children }: { children: React.ReactNode }) {
  const ctx = await labContext().catch(() => null);
  const instructor = ctx?.membership?.member.role === "instructor";
  return (
    <div className="lab">
      <header className="lab-top">
        <div className="lab-wrap wide lab-topin">
          <Link className="lab-brand" href="/lab">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/mark.png" alt="" />
            <span><b>MONARCH</b><small>Tax Lab · 2026 returns</small></span>
          </Link>
          {ctx ? (
            <nav className="lab-nav" aria-label="Tax Lab">
              <Link href="/lab">Scenarios</Link>
              {instructor ? <Link href="/lab/roster">Students</Link> : null}
              {instructor ? <Link href="/lab/review">Review</Link> : null}
              <form action={signOut}><button type="submit">Sign out</button></form>
            </nav>
          ) : null}
        </div>
      </header>
      {children}
    </div>
  );
}
