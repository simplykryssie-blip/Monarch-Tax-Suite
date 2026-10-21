import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalPage, Section, SUPPORT_EMAIL } from "@/components/legal/legal-page";
import { PLATFORM_LEGAL_APPROVED } from "@/lib/platform-legal";

export const metadata: Metadata = { title: "Acceptable Use Policy | Verexa HQ", robots: { index: false, follow: false } };

export default function AcceptableUsePage() {
  // Draft text with the owner's decisions in it: not available to visitors until counsel has reviewed it and the owner approves (see lib/platform-legal.ts).
  if (!PLATFORM_LEGAL_APPROVED) notFound();
  return (
    <LegalPage title="Acceptable Use Policy" platform>
      <Section heading="1. Purpose">
        <p>This policy applies to every account on Verexa HQ. It protects you, your clients, other customers and the Service. Breaking it can lead to sending being limited, or an account being suspended or ended.</p>
      </Section>
      <Section heading="2. You are responsible for your use">
        <p>You decide what you store, publish and send. The Service offers tools such as consent records, unsubscribe links and STOP handling, but using them does not by itself make your activity lawful. You remain responsible for following the laws and professional rules that apply to you. An account is for your own business only: do not resell access or share logins outside your business. Offices that operate under a Service Bureau count as part of that bureau&apos;s business.</p>
      </Section>
      <Section heading="3. Not allowed">
        <ul>
          <li>Unsolicited bulk or cold email or texts, purchased or scraped lists, or messages to people who have not agreed to hear from you.</li>
          <li>Misleading subject lines, hiding who you are, or leaving out your physical address and a working way to opt out.</li>
          <li>Ignoring unsubscribes, STOP replies, bounces or spam complaints.</li>
          <li>Storing or using other people&apos;s information without the right to do so; impersonating a person or business.</li>
          <li>Fraud, including preparing or filing false returns, or helping others to.</li>
          <li>Uploading malware, probing or attacking the Service or other customers, or getting around limits and security controls.</li>
          <li>Reselling or sharing your account access outside your business.</li>
          <li>Content that is unlawful, harassing, hateful or sexually explicit.</li>
        </ul>
      </Section>
      <Section heading="4. Websites and custom code">
        <p>Websites you build with the Service, including pages with your own HTML or script, must not:</p>
        <ul>
          <li>Pretend to be the IRS, a bank, a government body or another business, or imitate another sign-in page.</li>
          <li>Collect passwords, card numbers, Social Security numbers or other sensitive details under false pretenses (phishing).</li>
          <li>Contain malware, or track visitors without the notice the law requires.</li>
        </ul>
        <p>You are responsible for any code you add to a page.</p>
      </Section>
      <Section heading="5. Sending limits and health">
        <p>We watch bounce and complaint rates for each account. High rates slow sending automatically and can pause it until the list is cleaned up. Addresses that hard-bounce or report spam may be blocked platform-wide. If you send text messages, registering your texting with the carriers (A2P 10DLC) is your responsibility.</p>
      </Section>
      <Section heading="6. Enforcement and reporting">
        <p>If we act on your account we will email you the reason and tell you how to appeal: reply to us and we answer within 5 business days. We may act immediately, without a prior warning, only for illegal content, fraud or a security risk. We may remove content, limit features or suspend accounts that break this policy, and may report unlawful activity. [To confirm with counsel: wording of the notice and appeal steps.] Report abuse to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
      </Section>
    </LegalPage>
  );
}
