import type { Metadata } from "next";
import { LegalPage, Section, SUPPORT_EMAIL } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Terms of Service and Software License | Monarch Tax Suite", description: "Draft terms and software license for Monarch Tax Suite products." };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service and Software License Agreement">
      <Section heading="1. Agreement">
        <p>
          These terms govern your purchase and use of Monarch Tax Suite software, including the Monarch Basic Tax Calculator (the “Software”). By purchasing, activating or
          using the Software you agree to these terms. Questions: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </Section>
      <Section heading="2. What you are buying">
        <p>
          The Software is hosted by Monarch Tax Suite and displayed on your website through an embed (for example, an iframe). You receive the right to display it as described
          below. You do not receive the source code, and you do not need a Monarch-paid account on any third-party platform.
        </p>
      </Section>
      <Section heading="3. License grant">
        <p>
          Subject to these terms and full payment, Monarch grants you a limited, non-exclusive, non-transferable, non-sublicensable license to display the licensed version of the
          Software on the website domain(s) authorized for your license. A license covers the number of authorized domains stated on your order or approved by Monarch in writing
          [To confirm: one domain per license]. Access is controlled by your license and its authorized domains.
        </p>
      </Section>
      <Section heading="4. Prices, updates and no subscription">
        <ul>
          <li>Basic Tax Calculator: $75.00 USD, one-time purchase.</li>
          <li>Annual Tax-Year Update: $50.00 USD, one-time purchase for each optional update.</li>
          <li>
            There is no subscription and no automatic renewal. Monarch will never charge you automatically for a future tax-year update; an update is bought only when you choose
            to buy it.
          </li>
          <li>An update upgrades your existing license to a newer tax-year version. It is not a second base license.</li>
          <li>If you do not buy an update, the version you already licensed remains available to you.</li>
          <li>Prices are stated in U.S. dollars and may change for future purchases. Applicable taxes, if any, are shown at checkout.</li>
        </ul>
      </Section>
      <Section heading="5. Restrictions">
        <p>You may not, and may not allow others to:</p>
        <ul>
          <li>share your license key or embed code, or use the Software on a domain that is not authorized for your license;</li>
          <li>resell, rent, sublicense, white-label or redistribute the Software or access to it;</li>
          <li>copy, scrape, reverse engineer or attempt to extract the source code, or interfere with or work around the domain authorization or any security feature;</li>
          <li>use the Software unlawfully or in a way that harms Monarch, its hosting, or other customers.</li>
        </ul>
      </Section>
      <Section heading="6. Transfers">
        <p>
          A license may be transferred to another person or business only with Monarch’s prior written approval, subject to applicable law. An unapproved transfer is not valid.
        </p>
      </Section>
      <Section heading="7. Estimates only — not tax or legal advice">
        <p>
          The Software produces estimates from the inputs entered. It is a general-purpose tool and does not provide tax, legal, accounting or financial advice. Results may be
          incomplete or may differ from a filed return. You are responsible for reviewing results, for how you present them to your own clients, and for complying with the rules
          that apply to your profession. Monarch does not guarantee that any result, tax-year version or feature is accurate, complete or suitable for a particular purpose.
        </p>
      </Section>
      <Section heading="8. Hosting and availability">
        <p>
          The Software is provided as a hosted service on an “as available” basis. Monarch does not guarantee uninterrupted or error-free operation, or that it will work on
          every website platform, theme or browser. Embedding on third-party platforms is outside Monarch’s control. A “Done For You” installation, if purchased, is performed
          on the website and platform details you provide.
        </p>
      </Section>
      <Section heading="9. Contact forms and data collected on your site">
        <p>
          If you turn on the optional lead form, the information a visitor enters is sent to the destination you configure (for example, your CRM or a webhook). You are
          responsible for your own privacy notice, visitor consent and lawful use of that information. See the Privacy Policy for how Monarch handles it.
        </p>
      </Section>
      <Section heading="10. Suspension and termination">
        <p>
          Monarch may suspend or revoke a license if these terms are breached, if a payment is refunded, reversed or disputed, or to protect the Software or other customers. A
          full refund of the original purchase ends the license. A refunded or disputed annual update reverses only that update.
        </p>
      </Section>
      <Section heading="11. Refunds">
        <p>Refunds are governed by the Refund and Cancellation Policy.</p>
      </Section>
      <Section heading="12. Disclaimers and limits of liability">
        <p>
          To the fullest extent permitted by law, the Software is provided “as is” and “as available” without warranties of any kind, and Monarch’s total liability for any claim
          relating to the Software is limited to the amount you paid for the license giving rise to the claim. Monarch is not liable for indirect, incidental, special or
          consequential damages, lost profits or lost data. Some jurisdictions do not allow certain limits, so parts of this section may not apply to you.
          [To confirm with counsel: scope and wording of these limits.]
        </p>
      </Section>
      <Section heading="13. Governing law">
        <p>
          These terms are proposed to be governed by the laws of the State of Louisiana, without regard to conflict-of-law rules. [To confirm with counsel: governing law and
          venue.]
        </p>
      </Section>
      <Section heading="14. Changes">
        <p>
          Monarch may update these terms for future purchases and for continued use after notice posted on this page. The date above shows the latest revision.
        </p>
      </Section>
    </LegalPage>
  );
}
