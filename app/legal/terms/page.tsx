import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalPage, Section, SUPPORT_EMAIL } from "@/components/legal/legal-page";
import { PLATFORM_LEGAL_APPROVED } from "@/lib/platform-legal";

export const metadata: Metadata = { title: "Terms of Service | Verexa HQ", robots: { index: false, follow: false } };

export default function TermsPage() {
  // Placeholder text: not available to visitors until the owner approves final wording (see lib/platform-legal.ts).
  if (!PLATFORM_LEGAL_APPROVED) notFound();
  return (
    <LegalPage title="Terms of Service" platform>
      <Section heading="1. Who we are and what this covers">
        <p>These terms are between you (the person or business that opens an account) and Verexa HQ [To confirm: legal entity name, state, address]. Verexa HQ provides software for tax professionals: client records, documents and e-signature, forms, scheduling, messaging, invoices, websites and related tools (the “Service”). By creating an account you agree to these terms, the <a href="/legal/privacy">Privacy Policy</a>, the <a href="/legal/refunds">Refund Policy</a> and the <a href="/legal/acceptable-use">Acceptable Use Policy</a>.</p>
      </Section>
      <Section heading="2. Your account and plan">
        <p>You choose one plan when you sign up: PTIN holder ($99 per month), ERO ($199 per month) or Service Bureau ($299 per month) [To confirm: prices, what each plan includes, taxes]. You must give accurate information, keep your sign-in secure, and tell us if you believe your account was accessed without permission. You are responsible for everyone you give access to.</p>
      </Section>
      <Section heading="3. Billing">
        <p>There is no free trial. A payment method is required to sign up and is charged immediately, then each month on the same date until you cancel. If a payment fails we try again before the renewal date and tell you by email. If the payment is still unpaid on the renewal date your account is suspended [To confirm: exact retry schedule, grace period and notices]. A suspended account may become read-only and then be cancelled.</p>
      </Section>
      <Section heading="4. Pausing, cancelling and your data">
        <p>You can cancel at any time from your billing page [To confirm: effect on the paid period]. After cancellation we keep your data for 90 days so you can come back or export it, then it is permanently deleted, including files, texting numbers and connected addresses. A paused plan ($27 per month) keeps your data from being deleted with limited, contacts-only access [To confirm: what a paused account can do]. Deleted data cannot be recovered.</p>
      </Section>
      <Section heading="5. Your data and your clients">
        <p>Your client information belongs to you. You tell us what to do with it by using the Service, and we process it only to provide the Service. You are responsible for having the right to store and use it, for the accuracy of what you send, and for keeping your own legal and professional obligations (for example IRS rules, state rules, and your own security plan). We provide tools; we do not provide tax, legal or compliance advice and do not make you compliant.</p>
      </Section>
      <Section heading="6. Messages you send">
        <p>When you send email or text messages through the Service, you are the sender. You must follow the laws that apply to your messages (for example CAN-SPAM, TCPA and carrier rules), have the consent you need, and honour unsubscribe and STOP requests. See the Acceptable Use Policy. We may slow or pause sending if bounce or complaint rates are high.</p>
      </Section>
      <Section heading="7. Third-party services">
        <p>Some features use other providers (for example payments, email and text delivery, hosting). Your use of them may be subject to their terms. Online payments from your clients go through your own connected payment account [To confirm].</p>
      </Section>
      <Section heading="8. Suspension and termination">
        <p>We may suspend or end an account that breaks these terms, puts the Service or other customers at risk, or is not paid. Where we can, we will tell you first [To confirm].</p>
      </Section>
      <Section heading="9. Availability and liability">
        <p>We work to keep the Service available but do not promise it will be uninterrupted or error-free. [To confirm: warranty disclaimer, limitation of liability, indemnity, governing law and where disputes are handled.]</p>
      </Section>
      <Section heading="10. Changes and contact">
        <p>We may update these terms; we will tell you about material changes before they apply [To confirm: notice period]. Questions: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
      </Section>
    </LegalPage>
  );
}
