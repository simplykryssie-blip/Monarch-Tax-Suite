// The Terms, Privacy and Refund pages. While this is false, /terms, /privacy and
// /refunds answer 404 and nothing links to them. The business owner chose to publish
// them on 2026-10-10 (a public GoHighLevel Marketplace listing expects these links),
// WITH the "Draft for review" banner and the "[To confirm]" notes still in place:
// counsel has not reviewed the text. Remove the banner in components/legal/legal-page.tsx
// and the bracketed notes only after counsel signs off.
// Typed `boolean` on purpose, so the guards below are not treated as dead code.
export const LEGAL_PAGES_APPROVED: boolean = true;

export const LEGAL_PATHS = ["/terms", "/privacy", "/refunds"] as const;

/**
 * The version of the Terms and Refund Policy a buyer accepts at checkout. It is recorded on the checkout and on the
 * order, so every order shows which text the buyer agreed to. Change it, and the "Last updated" date, whenever the
 * Terms or Refund Policy text changes.
 */
export const LEGAL_VERSION = "2026-10-09";
export const LEGAL_LAST_UPDATED = "October 9, 2026";
