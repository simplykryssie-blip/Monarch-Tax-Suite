# Password reset

* **Sign-in page → Reset password** (or "Forgot password?") asks for an email and sends a one-time link. The reply is always the same, so it cannot be used to discover which emails have accounts. Five requests a minute per visitor.
* The link opens `/auth/callback`, which exchanges its one-time code for a short session in that browser and sends the person to `/reset-password` to choose a new password (12 characters minimum).
* **Signed in:** the account menu → **Change password** opens the same page.

## One-time setup in Supabase (cannot be done from the app)
Production project `ftthniovwzxztkwtregz` → Authentication → URL Configuration:
1. **Site URL:** `https://app.monarchtaxsuite.com`
2. **Redirect URLs:** add `https://app.monarchtaxsuite.com/auth/callback` (and, while the fallback address is kept, `https://monarch-tax-suite.vercel.app/auth/callback`).

Without step 2, Supabase refuses to send people back to the app and the link fails.

## Email delivery
By default Supabase sends these emails itself from a shared address with a very low hourly limit. For reliable, branded delivery configure **Authentication → SMTP Settings** with Resend (host `smtp.resend.com`, port 465, user `resend`, password = a Resend API key, sender = your verified `@monarchtaxsuite.com` address).
