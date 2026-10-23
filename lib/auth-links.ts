// Password-reset links: what to tell the person when a link doesn't work, and a check for the emailed token. Pure.

/** The emailed `token_hash`: URL-safe characters only, a sensible length. */
export const isTokenHash = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(v);

export const RESET_LINK_EXPIRED = "That reset link has expired or was already used. Request a new one.";
export const RESET_LINK_INVALID = "That reset link is not valid. Request a new one.";
/** The link was opened in a different browser (or a mail app's built-in browser) than the one that asked for it. */
export const RESET_LINK_OTHER_BROWSER =
  "That link must be opened in the same browser you asked for it in. Open the email, copy the link, and paste it into that browser's address bar, or request a new link here and open it in this browser.";

/**
 * Why the one-time code couldn't be redeemed. A missing verifier means the browser has no record of asking for this
 * reset; it says nothing about the link itself, so it must not be reported as expired.
 */
export function callbackFailureMessage(error: { name?: string; code?: string } | null | undefined): string {
  if (error?.name === "AuthPKCECodeVerifierMissingError" || error?.code === "pkce_code_verifier_not_found") return RESET_LINK_OTHER_BROWSER;
  return RESET_LINK_EXPIRED;
}
