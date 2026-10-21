import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalPage, Section, SUPPORT_EMAIL } from "@/components/legal/legal-page";
import { PLATFORM_LEGAL_APPROVED } from "@/lib/platform-legal";

export const metadata: Metadata = { title: "Refund Policy | Verexa HQ", robots: { index: false, follow: false } };

export default function RefundsPage() {
  // Placeholder text: not available to visitors until the owner approves final wording (see lib/platform-legal.ts).
  if (!PLATFORM_LEGAL_APPROVED) notFound();
  return (
    <LegalPage title="Refund Policy" platform>
      <Section heading="1. No free trial, charged at signup">
        <p>Your first payment is taken when you sign up and then each month on the same date. There is no trial period.</p>
      </Section>
      <Section heading="2. Refunds">
        <p>[To confirm: Are subscription payments refundable? Within how many days? Are partial months refunded on cancellation or downgrade? What about duplicate or mistaken charges, and text-message credits, which are prepaid?] Until this is decided, please contact <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> about any charge you think is wrong.</p>
      </Section>
      <Section heading="3. Cancelling">
        <p>You can cancel at any time from your billing page. [To confirm: whether access continues to the end of the paid period.] After cancellation your data is kept for 90 days and then deleted. See the Terms of Service.</p>
      </Section>
      <Section heading="4. Upgrades, downgrades and pausing">
        <p>[To confirm: how charges are adjusted when you change plan.] A paused plan costs $27 per month and keeps your data from being deleted.</p>
      </Section>
      <Section heading="5. Disputes">
        <p>Please contact us before disputing a charge with your bank. A chargeback can lead to your account being suspended while it is reviewed.</p>
      </Section>
    </LegalPage>
  );
}
