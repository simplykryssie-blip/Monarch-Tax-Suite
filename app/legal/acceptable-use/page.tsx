import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalPage, Section, SUPPORT_EMAIL } from "@/components/legal/legal-page";
import { PLATFORM_LEGAL_APPROVED } from "@/lib/platform-legal";

export const metadata: Metadata = { title: "Acceptable Use Policy | Verexa HQ", robots: { index: false, follow: false } };

export default function AcceptableUsePage() {
  // Placeholder text: not available to visitors until the owner approves final wording (see lib/platform-legal.ts).
  if (!PLATFORM_LEGAL_APPROVED) notFound();
  return (
    <LegalPage title="Acceptable Use Policy" platform>
      <Section heading="1. Purpose">
        <p>This policy applies to every account on Verexa HQ. It protects you, your clients, other customers and the Service. Breaking it can lead to sending being limited, an account being suspended or ended.</p>
      </Section>
      <Section heading="2. You are responsible for your use">
        <p>You decide what you store and send. The Service offers tools such as consent records, unsubscribe links and STOP handling, but using them does not by itself make your activity lawful. You remain responsible for following the laws and professional rules that apply to you.</p>
      </Section>
      <Section heading="3. Not allowed">
        <ul>
          <li>Unsolicited bulk or cold email or texts, purchased or scraped lists, or messages to people who have not agreed to hear from you.</li>
          <li>Misleading subject lines, hiding who you are, or leaving out your physical address and a working way to opt out.</li>
          <li>Ignoring unsubscribes, STOP replies, bounces or spam complaints.</li>
          <li>Storing or using other people&apos;s information without the right to do so; impersonating a person or business.</li>
          <li>Fraud, including preparing or filing false returns, or helping others to.</li>
          <li>Uploading malware, probing or attacking the Service or other customers, or getting around limits and security controls.</li>
          <li>Reselling or sharing your account access outside your business [To confirm].</li>
          <li>Content that is unlawful, harassing, hateful or sexually explicit.</li>
        </ul>
      </Section>
      <Section heading="4. Sending limits and health">
        <p>We watch bounce and complaint rates for each account. High rates slow sending automatically and can pause it until the list is cleaned up. Addresses that hard-bounce or report spam may be blocked platform-wide.</p>
      </Section>
      <Section heading="5. Enforcement and reporting">
        <p>We may remove content, limit features or suspend accounts that break this policy, and may report unlawful activity [To confirm: notice and appeal process]. Report abuse to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
      </Section>
    </LegalPage>
  );
}
