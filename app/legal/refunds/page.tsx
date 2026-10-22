import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalPage, Section, SUPPORT_EMAIL } from "@/components/legal/legal-page";
import { PLATFORM_LEGAL_APPROVED } from "@/lib/platform-legal";

export const metadata: Metadata = { title: "Refund Policy | Verexa HQ", robots: { index: false, follow: false } };

export default function RefundsPage() {
  // Draft text with the owner's decisions in it: not available to visitors until counsel has reviewed it and the owner approves (see lib/platform-legal.ts).
  if (!PLATFORM_LEGAL_APPROVED) notFound();
  return (
    <LegalPage title="Refund Policy" platform>
      <Section heading="1. No free trial, charged at signup">
        <p>Your first payment is taken when you sign up and then each month on the same date. There is no trial period.</p>
      </Section>
      <Section heading="2. What we refund">
        <p>The only refund we give is for a duplicate or double payment of your platform subscription. We do not refund partial months, including when you cancel or change plan. If you think you were charged twice, contact <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
      </Section>
      <Section heading="3. Credits">
        <p>Prepaid text and email credits are never refunded, transferred or exchanged, including accidental over-purchases and double purchases of credits.</p>
      </Section>
      <Section heading="4. Cancelling">
        <p>You can cancel at any time from your billing page, and your access continues to the end of the period you have paid for. After cancellation your data is kept for 90 days and then deleted. See the Terms of Service.</p>
      </Section>
      <Section heading="5. Changing plans and pausing">
        <p>You can change plans from your billing page. The new plan starts the day you change it and is charged in full, less a credit for the unused days of your old plan, so you pay the difference. If the credit is more than the new price, the leftover stays as credit on your account for your next invoice and is never paid out as cash. [To confirm with counsel: wording of the plan-change credit.] A paused plan costs $27 per month and keeps your data from being deleted.</p>
      </Section>
      <Section heading="6. Disputes">
        <p>Please contact us before disputing a charge with your bank. A chargeback can lead to your account being suspended while it is reviewed.</p>
      </Section>
    </LegalPage>
  );
}
