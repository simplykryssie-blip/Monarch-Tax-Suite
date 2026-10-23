import Link from "next/link";
import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth-frame";
import { confirmRecoveryLink } from "@/lib/auth-actions";
import { isTokenHash } from "@/lib/auth-links.ts";

// The address in a password-reset email. Opening it only shows a button: the token is used when the button is pressed, so a
// mail scanner or link preview that fetches the address cannot use the link up, and the person can finish on any device.
export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false, follow: false } };

export default async function ConfirmResetPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string }> }) {
  const { token_hash: tokenHash, type } = await searchParams;
  if (type !== "recovery" || !isTokenHash(tokenHash)) {
    return (
      <AuthFrame>
        <div className="mt-login-card">
          <h1>Link not valid</h1>
          <p className="mt-login-sub">This password reset link is not valid. Request a new one.</p>
          <Link href="/forgot-password" className="monarch-primary mt-login-go">Request a new link</Link>
        </div>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame>
      <form action={confirmRecoveryLink}>
        <h1>Reset your password</h1>
        <p className="mt-login-sub">Continue to choose a new password.</p>
        <input type="hidden" name="token_hash" value={tokenHash} />
        <button type="submit" className="monarch-primary mt-login-go">Continue</button>
      </form>
    </AuthFrame>
  );
}
