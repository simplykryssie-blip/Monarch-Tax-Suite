import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Thank you | Monarch Tax Suite" };

/** Where Stripe returns the buyer. Reaching this page grants nothing: delivery starts only when the signed webhook confirms payment. */
export default function ThankYouPage() {
  return (
    <main className="monarch-public">
      <div className="monarch-public-card">
        <div className="monarch-eyebrow">MONARCH TAX SUITE</div>
        <h1>Thank you</h1>
        <p>Your payment is being confirmed. As soon as Stripe confirms it, usually within a minute, we email your next steps to the address you used at checkout.</p>
        <p>If nothing arrives within an hour, check your spam folder or write to <a href="mailto:support@verexahq.com">support@verexahq.com</a>.</p>
        <p><Link href="/shop">Back to the shop</Link></p>
      </div>
    </main>
  );
}
