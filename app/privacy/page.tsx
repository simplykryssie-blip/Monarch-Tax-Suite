import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LEGAL_PAGES_APPROVED } from "@/lib/legal";
import { LegalPage, Section, SUPPORT_EMAIL } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Privacy Policy | Monarch Tax Suite", description: "Draft privacy policy for Monarch Tax Suite." };

export default function PrivacyPage() {
  // Unapproved draft: not available to visitors until the owner and counsel approve it (see lib/legal.ts).
  if (!LEGAL_PAGES_APPROVED) notFound();
  return (
    <LegalPage title="Privacy Policy">
      <Section heading="1. Who we are">
        <p>
          Monarch Tax Suite (“Monarch”, “we”) sells and hosts tax-professional software. Contact: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </Section>
      <Section heading="2. What we collect from purchasers">
        <ul>
          <li>Name and email address, and the payment reference, amount and status, received from our payment processor (Stripe) when you buy.</li>
          <li>Your license and installation details: the website domain(s) you authorize, the page URL and platform you tell us about, and notes about your installation.</li>
          <li>Messages you send to support.</li>
        </ul>
        <p>Payments are handled by Stripe. Monarch does not receive or store full card numbers.</p>
      </Section>
      <Section heading="3. The calculator and visitors to your website">
        <p>
          The calculator runs in the visitor’s browser inside the embed. Monarch checks the license and the website domain when the embed loads. Monarch does not create accounts for
          your website visitors and does not keep a database of their calculator entries.
        </p>
      </Section>
      <Section heading="4. Optional lead form">
        <p>
          If a customer turns on the optional lead form, what a visitor enters (name, email and/or phone, consent, and optionally tax year, filing status and an estimated
          result) is sent during that request to the destination the customer configured, such as their CRM or webhook. Monarch does not store this information and does not write
          it to its logs; it is held in memory only while the request is processed. The figures typed into the calculator are used on Monarch&apos;s server only to calculate the results that are sent
          along with the contact details; the figures themselves are not forwarded, stored or logged. The customer is responsible for how they use what they receive and for their own
          privacy notice. If delivery fails the visitor is asked to try again, and nothing is saved by Monarch.
        </p>
      </Section>
      <Section heading="5. Abuse-prevention data">
        <p>
          To limit abuse we keep short-lived counters tied to a keyed one-way hash of a network address (not the address itself) and to the public embed identifier. These are used
          only for rate limiting and are removed automatically (within about a day for the counters; delivery diagnostics with no personal details are deleted after about 30
          days). [To confirm against the final configuration before publishing.]
        </p>
      </Section>
      <Section heading="6. How we use information">
        <p>To process orders, issue and manage licenses, set up installations, provide support, protect the service from fraud and abuse, and meet legal obligations.</p>
      </Section>
      <Section heading="7. Who we share it with">
        <p>
          Service providers that help us operate: Stripe (payments), Supabase (database and storage), and Vercel (hosting). We also share information when required by law. We do
          not sell personal information. If you connect a CRM, information you choose to send goes to that CRM under your account and its terms.
        </p>
      </Section>
      <Section heading="8. Retention">
        <p>We keep order, license and installation records as long as needed for the license, accounting, tax and legal purposes. [To confirm retention periods.]</p>
      </Section>
      <Section heading="9. Security">
        <p>
          We use reasonable technical and organizational measures, such as access controls and encrypted storage of connection credentials. No method of transmission or storage is
          completely secure, and we cannot guarantee absolute security.
        </p>
      </Section>
      <Section heading="10. Your choices">
        <p>
          To ask about, correct or delete information we hold about you, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. We will respond as required by applicable law.
          Visitors to a customer’s website should contact that customer about information entered into that customer’s form.
        </p>
      </Section>
      <Section heading="11. Children">
        <p>Our products are for tax professionals and are not directed to children under 13.</p>
      </Section>
      <Section heading="12. Changes">
        <p>We may update this policy. The date above shows the latest revision.</p>
      </Section>
    </LegalPage>
  );
}
