import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LEGAL_PAGES_APPROVED } from "@/lib/legal";
import { LegalPage, Section, SUPPORT_EMAIL } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Refund and Cancellation Policy | Monarch Tax Suite", description: "Refund and cancellation policy for Monarch Tax Suite products." };

export default function RefundPolicyPage() {
  // Unapproved draft: not available to visitors until the owner and counsel approve it (see lib/legal.ts).
  if (!LEGAL_PAGES_APPROVED) notFound();
  return (
    // Approved as final by the owner on 2026-10-11, so it carries no draft banner.
    <LegalPage title="Refund and Cancellation Policy" draft={false}>
      <Section heading="1. All sales are final">
        <p>
          All sales are final. Due to the nature of digital products, software licenses, courses, and services, Monarch Tax Suite does not offer refunds, exchanges, or
          transfers on any purchase. This includes license keys, downloadable products, course access, and service fees. License keys are issued to the purchaser only and may
          not be transferred to another individual or business. By completing a purchase, you acknowledge and agree to this policy.
        </p>
      </Section>
      <Section heading="2. Payment disputes">
        <p>
          A payment dispute or chargeback may cause the license to be suspended while it is reviewed. If you have a problem with a purchase, please contact us first at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> so we can try to resolve it.
        </p>
      </Section>
      <Section heading="3. Cancellation">
        <p>
          There is no subscription. The Basic Tax Calculator ($75.00) and each Annual Tax-Year Update ($50.00) are one-time purchases, and nothing renews or is charged
          automatically, so there is nothing to cancel. If you start checkout and do not complete payment, you are not charged.
        </p>
      </Section>
      <Section heading="4. Governing law">
        <p>
          This policy is proposed to be governed by the laws of the State of Louisiana. Nothing here limits any rights you have under law that cannot be
          waived.
        </p>
      </Section>
    </LegalPage>
  );
}
