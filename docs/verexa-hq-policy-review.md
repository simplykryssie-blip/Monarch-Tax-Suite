# Verexa HQ policies: review copy

**Status: DRAFT for owner and counsel review. Not published.** The four policies below are the text currently in the code (`app/legal/*`). They return a 404 and nothing links to them until `PLATFORM_LEGAL_APPROVED` is turned on. Every open point is marked **[To confirm]** in the text. This document adds, for each policy, what the product *actually does today*, so the wording can match it, and the decisions the owner has to make.

Version recorded with each signup: `draft-2026-10-19`. When the wording changes, the version is updated so each account shows which text it agreed to.

Reviewer note: this is not legal advice. Counsel review is recommended before publishing, mainly because the platform handles tax-client data (SSNs, tax documents), sends marketing email and text, and takes subscription payments.

---

## What the product actually does (facts the wording must match)

**Plans and billing**
- PTIN $99, ERO $199, Service Bureau $299 per month. Pause plan $27 per month. Public signup is PTIN only for now.
- No trial. The card is charged at signup, then monthly on the same date.
- The card is checked 7, 5 and 3 days before renewal and the owner is emailed.
- Unpaid at renewal: account **suspended** (messages stop) for 7 days, then **read-only** for 14 days, then **cancelled**.
- Cancelling from the Billing page takes effect at the end of the paid period. Plan switching inside the portal is off.
- After cancellation, data is kept 90 days, then deleted. (The deletion job itself is not built yet; it needs its own approval.)
- A paused account has contacts-only access.
- Monarch Tax Suite is on a free internal plan.

**Data**
- Each customer's data is separated from every other customer's (database-level isolation).
- Social Security numbers are stored encrypted. The platform owner reveal screen is not built yet.
- Audit records exist for important actions.

**Messaging**
- Customers are the sender. The platform records consent, honours unsubscribe and STOP, blocks hard bounces and spam complaints platform-wide (stored as hashed values only), and slows or pauses sending when bounce or complaint rates are high.

**Payments from clients**
- Client payments go through each office's own connected Stripe account.

**Websites**
- Customers can build websites, including a **Custom HTML block** that runs the customer's own code in a sandboxed frame.

**Providers used**
- Hosting (Vercel), database (Supabase), payments (Stripe), email (Resend), text (Twilio), bot check (Cloudflare Turnstile).

---

## Decisions for the owner (these fill the [To confirm] points)

| # | Decision | Where it appears | What the product does now |
|---|---|---|---|
| 1 | Legal entity name, state and address | Terms 1 | Not set |
| 2 | Are subscription payments refundable? Window? Partial months? | Refunds 2, Terms 3 | Nothing automatic; refunds are manual in Stripe |
| 3 | Does access continue to the end of the paid period after cancelling? | Terms 4, Refunds 3 | Yes (cancel at period end) |
| 4 | Plan changes: how are charges adjusted? | Refunds 4 | Plan switching is off |
| 5 | What can a paused ($27) account do? | Terms 4 | Contacts-only access |
| 6 | Retry and grace schedule wording | Terms 3 | 7/5/3-day checks, 7 days suspended, 14 days read-only |
| 7 | Prepaid text credits: refundable? | Refunds 2 | Not addressed |
| 8 | Warranty disclaimer, liability cap, indemnity, governing law, dispute venue | Terms 9 | Not set (counsel) |
| 9 | Notice period for changes to the terms | Terms 10 | Not set |
| 10 | Do we notify before suspending for a breach? | Terms 8 | Not set |
| 11 | Controller / processor wording and a data-processing addendum | Privacy 1 | Not set (counsel) |
| 12 | How SSN access, masking and logging are described | Privacy 3 | Reveal screen not built |
| 13 | Final provider list and where data is stored | Privacy 5 | See list above |
| 14 | Backups, legal holds, records kept after deletion (invoices) | Privacy 6 | Not set |
| 15 | Privacy rights by state and response times | Privacy 7 | Not set |
| 16 | Account sharing / reselling rules | Acceptable Use 3 | Not enforced in code |
| 17 | Notice and appeal process for enforcement | Acceptable Use 5 | Not set |

---

## Gaps I recommend adding (not in the current drafts)

1. **Websites and Custom HTML (Acceptable Use).** The policy covers email, text and data but says nothing about customer websites. Add: no phishing or pages that collect passwords, card numbers or SSNs under false pretenses; no malware or tracking without notice; no impersonation of the IRS, a bank or another business; the customer is responsible for the code they paste in.
2. **Tax-practice obligations (Terms 5).** The text says the platform doesn't make customers compliant. Consider naming IRS Publication 1345 and the FTC Safeguards Rule / WISP duties so the customer cannot claim the platform took them on.
3. **Data export on cancellation (Terms 4).** The text promises a chance to "export it". Confirm the product actually offers a full export before keeping that promise.
4. **SMS terms (Acceptable Use 4).** Mention carrier registration (A2P 10DLC) responsibility, which sits with the customer.
5. **Service Bureau offices (Terms 2).** When ERO and Bureau signup opens, say who is responsible for the offices under a bureau.
6. **Subprocessor change notice (Privacy 5).** Say how customers hear about a new provider.

---

## The four policies as drafted

### Terms of Service

1. **Who we are and what this covers.** Between you (the person or business that opens an account) and Verexa HQ [To confirm: legal entity name, state, address]. Software for tax professionals: client records, documents and e-signature, forms, scheduling, messaging, invoices, websites and related tools. By creating an account you agree to these terms, the Privacy Policy, the Refund Policy and the Acceptable Use Policy.
2. **Your account and plan.** One plan at signup: PTIN holder ($99/month), ERO ($199/month) or Service Bureau ($299/month) [To confirm: prices, what each plan includes, taxes]. Accurate information; keep your sign-in secure; tell us of unauthorized access. You are responsible for everyone you give access to.
3. **Billing.** No free trial. Payment method required and charged immediately, then monthly on the same date until you cancel. A failed payment is retried before the renewal date with email notice. Still unpaid at renewal: suspended [To confirm: exact retry schedule, grace period and notices]. A suspended account may become read-only and then be cancelled.
4. **Pausing, cancelling and your data.** Cancel any time from the billing page [To confirm: effect on the paid period]. After cancellation data is kept 90 days to come back or export, then permanently deleted, including files, texting numbers and connected addresses. A paused plan ($27/month) keeps data from being deleted, with limited, contacts-only access [To confirm: what a paused account can do]. Deleted data cannot be recovered.
5. **Your data and your clients.** Your client information belongs to you. We process it only to provide the Service. You are responsible for having the right to store and use it, its accuracy, and your own legal and professional obligations (IRS rules, state rules, your own security plan). We provide tools; we do not provide tax, legal or compliance advice and do not make you compliant.
6. **Messages you send.** You are the sender. Follow the laws that apply (CAN-SPAM, TCPA, carrier rules), have the consent you need, honour unsubscribe and STOP. We may slow or pause sending if bounce or complaint rates are high.
7. **Third-party services.** Some features use other providers (payments, email and text delivery, hosting), subject to their terms. Online payments from your clients go through your own connected payment account [To confirm].
8. **Suspension and termination.** We may suspend or end an account that breaks these terms, puts the Service or other customers at risk, or is not paid. Where we can, we will tell you first [To confirm].
9. **Availability and liability.** We work to keep the Service available but do not promise it will be uninterrupted or error-free. [To confirm: warranty disclaimer, limitation of liability, indemnity, governing law and where disputes are handled.]
10. **Changes and contact.** We may update these terms and will tell you about material changes before they apply [To confirm: notice period]. support@verexahq.com.

### Privacy Policy

1. **Two roles.** *Account information* about the person who signs up we use to run the account. *Your clients' information* we process on your behalf and under your instructions [To confirm: controller/processor wording and any data-processing terms].
2. **What we collect.** Account details (name, email, phone, business name, plan); billing (handled by the payment provider; we receive plan, status and last digits of the card, not the full number); usage and security records (sign-in events, audit records, IP-derived technical data); content you add (client records, files, form answers, messages, website content).
3. **Sensitive information.** SSNs and other identifiers are stored encrypted and shown only to people allowed to see them [To confirm: describe access, masking and logging once the owner reveal screen is final]. Never put card numbers or passwords into notes or form answers.
4. **How we use information.** To provide and secure the Service, bill you, send service messages, prevent abuse and fraud, meet legal duties, and improve the product using aggregate information. We do not sell your or your clients' information and do not use clients' information for advertising.
5. **Who else handles it.** Providers that help run the Service: hosting and database, payments, email delivery, text delivery, website hosting [To confirm: final provider list and where data is stored]. They may only use it to provide their service to us. We may disclose information if the law requires it.
6. **Keeping and deleting.** Kept while the account is active. After cancellation, 90 days, then permanent deletion [To confirm: backups, legal holds, records we must keep such as invoices].
7. **Your choices.** Access, correct or export your account information, and delete your account. Clients of a customer should contact that business first [To confirm: rights by state, response times].
8. **Security, cookies, children, changes.** Encryption in transit and for sensitive fields, access controls between customers, audit records [To confirm]. Only cookies needed to sign in and keep the Service secure [To confirm]. Not for children. We will tell you about material changes. support@verexahq.com.

### Refund Policy

1. **No free trial, charged at signup.** First payment at signup, then monthly on the same date.
2. **Refunds.** [To confirm: Are subscription payments refundable? Within how many days? Are partial months refunded on cancellation or downgrade? Duplicate or mistaken charges? Text-message credits, which are prepaid?] Until decided, contact support@verexahq.com about any charge you think is wrong.
3. **Cancelling.** Any time from the billing page. [To confirm: whether access continues to the end of the paid period.] Data kept 90 days, then deleted.
4. **Upgrades, downgrades and pausing.** [To confirm: how charges are adjusted when you change plan.] A paused plan costs $27/month and keeps data from being deleted.
5. **Disputes.** Contact us before disputing a charge with your bank. A chargeback can lead to suspension while it is reviewed.

### Acceptable Use Policy

1. **Purpose.** Applies to every account. Breaking it can lead to sending being limited, or an account being suspended or ended.
2. **You are responsible for your use.** You decide what you store and send. Consent records, unsubscribe links and STOP handling do not by themselves make your activity lawful.
3. **Not allowed.** Unsolicited bulk or cold email or texts, purchased or scraped lists, messages to people who haven't agreed; misleading subject lines, hiding who you are, omitting your physical address or a working opt-out; ignoring unsubscribes, STOP replies, bounces or complaints; storing or using other people's information without the right, impersonation; fraud, including false returns; malware, probing or attacking the Service, getting around limits; reselling or sharing account access outside your business [To confirm]; unlawful, harassing, hateful or sexually explicit content.
4. **Sending limits and health.** Bounce and complaint rates are watched per account. High rates slow sending automatically and can pause it. Addresses that hard-bounce or report spam may be blocked platform-wide.
5. **Enforcement and reporting.** We may remove content, limit features or suspend accounts, and may report unlawful activity [To confirm: notice and appeal process]. support@verexahq.com.

---

## How to approve

1. Owner answers the decisions table; counsel reviews the wording and the gaps list.
2. Send back the final text. It replaces the drafts in `app/legal/*`, the draft banner is removed, `PLATFORM_LEGAL_VERSION` and the date are updated, and `PLATFORM_LEGAL_APPROVED` is set to `true` in one pull request.
3. Merging that PR deploys it; the policies go public and signup becomes eligible to open (Turnstile keys and billing are already in place).
