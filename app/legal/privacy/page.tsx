import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalPage, Section, SUPPORT_EMAIL } from "@/components/legal/legal-page";
import { PLATFORM_LEGAL_APPROVED } from "@/lib/platform-legal";

export const metadata: Metadata = { title: "Privacy Policy | Verexa HQ", robots: { index: false, follow: false } };

export default function PrivacyPage() {
  // Placeholder text: not available to visitors until the owner approves final wording (see lib/platform-legal.ts).
  if (!PLATFORM_LEGAL_APPROVED) notFound();
  return (
    <LegalPage title="Privacy Policy" platform>
      <Section heading="1. Two roles">
        <p>Verexa HQ handles two kinds of information. <b>Account information</b> about you, the person who signs up (name, email, business details, billing) we use to run your account; for that we decide how it is used. <b>Your clients&apos; information</b> that you put into the Service (names, contact details, documents, tax-related records, messages) we process on your behalf and under your instructions [To confirm: controller/processor wording and any data-processing terms].</p>
      </Section>
      <Section heading="2. What we collect">
        <ul>
          <li>Account details: name, email, phone, business name, plan.</li>
          <li>Billing: handled by our payment provider; we receive the plan, status and the last digits of the card, not the full card number.</li>
          <li>Usage and security records: sign-in events, audit records of important actions, IP-derived technical data to prevent abuse.</li>
          <li>Content you add: client records, files, form answers, messages, website content.</li>
        </ul>
      </Section>
      <Section heading="3. Sensitive information">
        <p>Social Security numbers and other identifiers are stored encrypted and shown only to the people allowed to see them [To confirm: describe access, masking and logging once the owner reveal screen is final]. Never put payment card numbers or passwords into notes or form answers.</p>
      </Section>
      <Section heading="4. How we use information">
        <p>To provide and secure the Service, bill you, send service messages, prevent abuse and fraud, meet legal duties, and improve the product using aggregate information. We do not sell your information or your clients&apos; information, and we do not use your clients&apos; information for advertising.</p>
      </Section>
      <Section heading="5. Who else handles it">
        <p>Providers that help us run the Service: hosting and database, payments, email delivery, text delivery, and website hosting [To confirm: final list of providers and where data is stored]. They may only use it to provide their service to us. We may disclose information if the law requires it.</p>
      </Section>
      <Section heading="6. Keeping and deleting">
        <p>We keep your data while your account is active. After cancellation we keep it for 90 days, then permanently delete it [To confirm: backups, legal holds, records we must keep such as invoices].</p>
      </Section>
      <Section heading="7. Your choices">
        <p>You can ask to access, correct or export your account information, and to delete your account. If you are a client of one of our customers, contact that business first; we will help them answer you [To confirm: rights by state, response times].</p>
      </Section>
      <Section heading="8. Security, cookies, children, changes">
        <p>We use encryption in transit and for sensitive fields, access controls between customers, and audit records [To confirm]. We use only the cookies needed to sign you in and keep the Service secure [To confirm]. The Service is not for children. We will tell you about material changes. Contact: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
      </Section>
    </LegalPage>
  );
}
