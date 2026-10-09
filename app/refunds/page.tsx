import type { Metadata } from "next";
import { LegalPage, Section, SUPPORT_EMAIL } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Refund and Cancellation Policy | Monarch Tax Suite", description: "Draft refund and cancellation policy for Monarch Tax Suite products." };

export default function RefundPolicyPage() {
  return (
    <LegalPage title="Refund and Cancellation Policy">
      <Section heading="1. Refunds are generally final">
        <p>
          Monarch Tax Suite software is a digital product delivered when your license is issued. Purchases are generally final and non-refundable, except where a refund is
          required by applicable law or is expressly approved by Monarch in writing under this policy.
        </p>
      </Section>
      <Section heading="2. When we will refund">
        <ul>
          <li>You were charged more than once for the same purchase, or charged an incorrect amount because of our error.</li>
          <li>A refund is required by law where you live.</li>
          <li>Monarch agrees in writing to a refund after reviewing your request, for example when the Software cannot be made to work as described and we are unable to fix it.</li>
        </ul>
      </Section>
      <Section heading="3. How to request a refund">
        <p>
          Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with the email address used at checkout, the order date, and the reason for your request. We will reply with
          a decision. Approved refunds are returned to the original payment method; your bank may take several business days to show it.
          [To confirm: response time commitment.]
        </p>
      </Section>
      <Section heading="4. Effect on your license">
        <ul>
          <li>A full refund of the original purchase ends the license, and access to the Software on your authorized domain(s) stops.</li>
          <li>A refund of an annual update reverses only that update. Your base license remains active.</li>
          <li>A payment dispute or chargeback may cause the license to be suspended while it is reviewed. Please contact us first so we can try to resolve the problem.</li>
        </ul>
      </Section>
      <Section heading="5. Cancellation">
        <p>
          There is no subscription. The Basic Tax Calculator ($75.00) and each Annual Tax-Year Update ($50.00) are one-time purchases, and nothing renews or is charged
          automatically, so there is nothing to cancel. If you start checkout and do not complete payment, you are not charged.
        </p>
      </Section>
      <Section heading="6. Governing law">
        <p>
          This policy is proposed to be governed by the laws of the State of Louisiana. [To confirm with counsel.] Nothing here limits any rights you have under law that cannot be
          waived.
        </p>
      </Section>
    </LegalPage>
  );
}
