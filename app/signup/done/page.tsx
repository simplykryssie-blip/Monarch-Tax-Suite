import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/components/auth-frame";
import { PLATFORM } from "@/lib/platform-brand";

export const metadata: Metadata = { title: `Payment received | ${PLATFORM.name}`, robots: { index: false, follow: false } };

export default function DonePage() {
  return (
    <AuthFrame>
      <div role="status">
        <h1>Payment received</h1>
        <p className="mt-login-sub">Thank you. We&apos;re setting up your workspace and emailing you a link to set your password. It usually takes less than a minute; check your spam folder if it doesn&apos;t arrive.</p>
        <p><Link href="/login">Go to sign in</Link></p>
      </div>
    </AuthFrame>
  );
}
