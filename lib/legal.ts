// The Terms, Privacy and Refund pages are drafts that the business owner and
// legal counsel have NOT approved. While this is false, /terms, /privacy and
// /refunds answer 404 and nothing links to them. The draft text stays in
// app/terms, app/privacy and app/refunds so it can be reviewed and published:
// after written approval, change this to true (and remove the "Draft for review"
// banner in components/legal/legal-page.tsx once counsel has signed off).
// Typed `boolean` on purpose, so the guards below are not treated as dead code.
export const LEGAL_PAGES_APPROVED: boolean = false;

export const LEGAL_PATHS = ["/terms", "/privacy", "/refunds"] as const;
