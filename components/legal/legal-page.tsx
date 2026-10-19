import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL_LAST_UPDATED } from "@/lib/legal";
import { PLATFORM_SUPPORT_EMAIL } from "@/lib/platform-brand";

export const SUPPORT_EMAIL = PLATFORM_SUPPORT_EMAIL;

/**
 * Shared shell for the Terms, Privacy and Refund pages. A page shows the "Draft for review" banner until its text is
 * approved: the Refund Policy was approved as final by the owner on 2026-10-11 (`draft={false}`); Terms and Privacy
 * keep the banner until counsel reviews them.
 */
export function LegalPage({ title, children, draft = true }: { title: string; children: ReactNode; draft?: boolean }) {
  return (
    <main className="sf-page" style={{ maxWidth: 820, margin: "0 auto", padding: "32px 20px 64px", lineHeight: 1.65 }}>
      <header style={{ marginBottom: 24 }}>
        <div className="sf-eyebrow">MONARCH TAX SUITE</div>
        <h1 style={{ margin: "4px 0 8px" }}>{title}</h1>
        <p style={{ margin: 0, fontSize: 14, opacity: 0.75 }}>Last updated: {LEGAL_LAST_UPDATED}</p>
      </header>
      {draft && (<aside
        role="note"
        style={{ border: "1px solid #b8860b", background: "#fff8e1", color: "#4a3b00", padding: "12px 16px", borderRadius: 8, marginBottom: 28, fontSize: 14 }}
      >
        <strong>Draft for review.</strong> This document has not yet been reviewed or approved by the business owner or by legal counsel, and it is not legal advice. Items marked
        “[To confirm]” must be confirmed before this page is relied on.
      </aside>)}
      {children}
      <nav aria-label="Legal pages" style={{ marginTop: 40, paddingTop: 16, borderTop: "1px solid #d8d4c8", display: "flex", gap: 16, flexWrap: "wrap", fontSize: 14 }}>
        <Link href="/terms">Terms of Service</Link>
        <Link href="/privacy">Privacy Policy</Link>
        <Link href="/refunds">Refund Policy</Link>
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </nav>
    </main>
  );
}

export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 20, margin: "0 0 8px" }}>{heading}</h2>
      {children}
    </section>
  );
}
