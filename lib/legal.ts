// The Terms, Privacy and Refund pages. While this is false, /terms, /privacy and
// /refunds answer 404 and nothing links to them. The business owner chose to publish
// them on 2026-10-10 (a public GoHighLevel Marketplace listing expects these links),
// WITH the "Draft for review" banner and the "[To confirm]" notes still in place:
// counsel has not reviewed the text. Remove the banner in components/legal/legal-page.tsx
// and the bracketed notes only after counsel signs off.
// Typed `boolean` on purpose, so the guards below are not treated as dead code.
export const LEGAL_PAGES_APPROVED: boolean = true;

export const LEGAL_PATHS = ["/terms", "/privacy", "/refunds"] as const;
