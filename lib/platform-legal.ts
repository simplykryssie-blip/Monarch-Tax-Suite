// Verexa HQ's own policies (the platform's, as opposed to Monarch Tax Suite's: /terms, /privacy and /refunds are
// Monarch's, which its store and its marketplace listing rely on, and they are left as they are).
//
// While PLATFORM_LEGAL_APPROVED is false, /legal/* answers 404, nothing links to it and signup stays closed. The text in
// those pages is PLACEHOLDER DRAFT text, with every open point marked "[To confirm]". When the owner (and counsel)
// approve final wording, replace the text, set the date/version below, remove the draft banner and set this to true.
// The text now has the owner's decisions in it and is awaiting counsel review.
// Typed `boolean` on purpose, so the guards that read it are not treated as dead code.
export const PLATFORM_LEGAL_APPROVED: boolean = false;

export const PLATFORM_LEGAL_PATHS = ["/legal/terms", "/legal/privacy", "/legal/refunds", "/legal/acceptable-use"] as const;

/** Recorded with each signup so it shows which text the account holder agreed to. */
export const PLATFORM_LEGAL_VERSION = "draft-2026-10-21";
export const PLATFORM_LEGAL_LAST_UPDATED = "October 21, 2026 (draft)";
