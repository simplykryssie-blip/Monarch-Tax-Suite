import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalPage, Section, SUPPORT_EMAIL } from "@/components/legal/legal-page";
import { PLATFORM_LEGAL_APPROVED } from "@/lib/platform-legal";

export const metadata: Metadata = { title: "Terms of Service | Verexa HQ", robots: { index: false, follow: false } };

export default function TermsPage() {
  // Draft text with the owner's decisions in it: not available to visitors until counsel has reviewed it and the owner approves (see lib/platform-legal.ts).
  if (!PLATFORM_LEGAL_APPROVED) notFound();
  return (
    <LegalPage title="Terms of Service" platform>
      <Section heading="1. Who we are and what this covers">
        <p>These terms are between you (the person or business that opens an account) and Verexa HQ, a Louisiana company, 5520 Johnston Street, Lafayette, LA 70503 [To confirm with counsel: registered legal name and entity type]. Verexa HQ provides software for tax professionals: client records, documents and e-signature, forms, scheduling, messaging, invoices, websites and related tools (the “Service”). By creating an account you agree to these terms, the <a href="/legal/privacy">Privacy Policy</a>, the <a href="/legal/refunds">Refund Policy</a> and the <a href="/legal/acceptable-use">Acceptable Use Policy</a>.</p>
      </Section>
      <Section heading="2. Your account and plan">
        <p>You choose one plan when you sign up: PTIN holder ($99 per month), ERO ($199 per month) or Service Bureau ($299 per month) [To confirm: what each plan includes, taxes]. You must give accurate information, keep your sign-in secure, and tell us if you believe your account was accessed without permission. You are responsible for everyone you give access to. An account is for your own business only. If you run a Service Bureau, you are responsible for the offices that operate under it.</p>
      </Section>
      <Section heading="3. Billing">
        <p>There is no free trial. A payment method is required to sign up and is charged immediately, then each month on the same date until you cancel. Before a renewal we check your card and email you if it looks like it will fail. If a renewal payment fails, your workspace becomes read-only right away: you can look at your information but not change it, and no messages or automations run. The Billing page keeps working so you can update your card. We keep retrying the payment and send you reminders. If it is still unpaid after 14 days, the account is cancelled and your data is kept for 90 days (see section 4). Paying within those 90 days reactivates the account.</p>
      </Section>
      <Section heading="4. Changing, pausing, cancelling and your data">
        <p>You can change plans from your billing page [To confirm: how the charge is calculated when you change plan]. You can cancel at any time from your billing page, and your access continues to the end of the period you have paid for. After cancellation we keep your data for 90 days so you can come back, then it is permanently deleted, including files, texting numbers and connected addresses. A paused plan ($27 per month) keeps your data from being deleted and gives contacts-only access; when you resume, the full account is restored with no data missing. Deleted data cannot be recovered.</p>
      </Section>
      <Section heading="5. Credits">
        <p>Prepaid text or email credits are separate from your subscription. Credits are never refunded, transferred or exchanged, including accidental or duplicate purchases. A failed subscription payment does not change your credit balance, and a failed credit purchase does not affect your subscription: you keep the balance you have and cannot add more until a payment succeeds.</p>
      </Section>
      <Section heading="6. Your data and your clients">
        <p>Your client information belongs to you. You tell us what to do with it by using the Service, and we process it only to provide the Service. You are responsible for having the right to store and use it, for the accuracy of what you send, and for keeping your own legal and professional obligations, including IRS rules and Publication 1345, state rules, and the FTC Safeguards Rule and your own written information security plan (WISP). We provide tools; we do not provide tax, legal or compliance advice and do not make you compliant.</p>
        <p>Verexa HQ has no relationship with your clients. You own your client relationships and you are responsible for your services and for what you tell your clients. If a client of yours has a complaint or claim, they should take it to you first. You agree to defend and indemnify Verexa HQ against claims brought by your clients or other third parties arising from your services, your content or your use of the Service [To confirm with counsel: scope of indemnity].</p>
      </Section>
      <Section heading="7. Messages you send">
        <p>When you send email or text messages through the Service, you are the sender. You must follow the laws that apply to your messages (for example CAN-SPAM, TCPA and carrier rules), have the consent you need, and honour unsubscribe and STOP requests. Registering to send texts with carriers (A2P 10DLC) is your responsibility. See the Acceptable Use Policy. We may slow or pause sending if bounce or complaint rates are high.</p>
      </Section>
      <Section heading="8. Third-party services">
        <p>Some features use other providers (payments, email and text delivery, hosting). Your use of them may be subject to their terms. Online payments from your clients go through your own connected payment account.</p>
      </Section>
      <Section heading="9. Suspension and termination">
        <p>If you break these terms we will tell you what is wrong and give you time to fix it before we suspend or end your account. We may act immediately, and explain afterwards, where there is fraud, abuse or a risk to security. You can ask us to review any action by replying to our email or writing to support. An account that is not paid follows section 3.</p>
      </Section>
      <Section heading="10. Availability and liability">
        <p>The Service is provided “as is” and “as available”. We work to keep it available but do not promise it will be uninterrupted or error-free. To the fullest extent the law allows, Verexa HQ’s total liability to you for anything arising from the Service is limited to the fees you paid us in the 12 months before the claim. These terms are governed by Louisiana law, and disputes are heard in the state and federal courts located in Louisiana [To confirm with counsel: disclaimers, exclusions, venue parish, consumer-law limits].</p>
      </Section>
      <Section heading="11. Changes and contact">
        <p>We may update these terms. We will give you 30 days’ notice before a material change applies. Questions: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
      </Section>
    </LegalPage>
  );
}
