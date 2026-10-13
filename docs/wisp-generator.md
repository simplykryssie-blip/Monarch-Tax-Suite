# WISP Generator (rebuilt with a backend)

The source is the owner's static build (`wisp-generator-source`: index.html, styles.css, app.js, README), rebuilt as repo code. Migration: `supabase/migrations/20261018090000_wisp.sql`. Gate: `supabase/tests/wisp_isolation.sql`.

## Preserved from the README

- **Quiz:** 12 questions in 4 categories, weighted Access 30%, Physical 20%, Data 30%, Incident 20%. Answers score 2/1/0, and an unanswered question counts as the worst answer. The quiz is in `lib/wisp/content.ts`, ported unchanged.
- **ERO profiling:** the 4 optional questions shown while the score is "calculated" (is_ero, bureau, per_return_fee, volume).
- **Fee comparison:** shown whenever the visitor gives their per-return fee. If they pay more than the firm, it shows the saving (per season when they gave a volume). If they pay the same or less, it says so and suggests checking which fees their price includes. (The README showed it only above $223; changed at the owner's request after testing.)
- **Low scores:** a score under 40 shows "YOU DON'T HAVE A WISP".
- **Builder:** 6 steps (Firm → Systems → Access → Protections → Incident → Review), with the same fields and validation. The answers are checked again on the server.
- **Attorney-ready:** always defined as formatted for attorney review, never attorney-approved, and the disclaimer is on the page, in the PDF and in the email.
- **Brand:** black and metallic gold, Oswald headlines. The styles are `app/wisp/wisp.css`, scoped under `.wisp` so they don't affect the rest of the app.

## Added backend

1. **Saved before payment:**
   - On "Complete My WISP — $25", the builder's answers and the delivery email are saved as a plan.
   - The answers are encrypted, because they can include an EIN.
   - The buying browser gets a secret cookie.
   - Then a Stripe checkout starts for the store product `wisp-assisted-build`, through the existing storefront checkout. That means the same live price check, Terms acceptance and recorded session.
2. **After payment:** the signature-verified webhook records the order as usual, then hands the session to WISP delivery, which:
   - links the plan to the customer and order;
   - makes the PDF on the server;
   - files it in the tenant's private documents (`{tenant}/wisp/{plan}.pdf`);
   - emails it through Resend with the PDF attached and a download link that works for a year.
   - Stripe retries can't make or send it twice.
3. **Confirmation page (`/wisp/done`):**
   - waits for the payment confirmation;
   - makes the PDF or sends the email itself if the webhook's attempt failed;
   - always shows the download button.
   - If the email failed, it says so and offers "Try emailing it again", limited to once every two minutes.
4. **Re-download later:**
   - **Buyer:** the emailed link (`/wisp/d/{token}`). Each new email issues a new link.
   - **Administrators:** download or re-send from the customer's page, or from **My Store → WISP Generator** (`/store/wisp`).
5. **Delivery log:** every email attempt (sent, failed, held back on Preview) and every download is in `wisp_deliveries`, which can't be changed afterwards.
6. **Leads:**
   - Every finished audit is saved (score, breakdown, answers, ERO answers) even if the visitor never buys. No contact details are asked at that point.
   - Anyone who reaches the review step and gives an email is a lead even if they don't pay.
   - Both are listed on `/store/wisp`.
7. **Tenant-aware:**
   - All three tables carry `tenant_id` with the standard policies and same-tenant keys.
   - The public page belongs to the brand whose web address it was opened on (`email_domains.link_host`, found with one logged platform lookup), otherwise Monarch. It shows that brand's name.
   - Emails go from that tenant's default sending address.
   - **Payment** runs through the Monarch storefront's Stripe account, so only Monarch's builder takes payment today. Other firms see "Online checkout is not available yet".

## Also fixed

**PDF fonts (Forms too).** pdf-lib's subsetting of Noto Sans dropped the letter shapes, so the text was in the file but showed blank in some PDF viewers. The full font is now embedded in WISP and Form submission PDFs. Each file is about 650 KB.

## Fixed after the first test (2026-10-13)

- **Fee comparison:** it was hidden because $150 is under $223. It now always shows when a fee is given (see above).
- **Number of people with data access:** the number fields are now plain text fields with a number keypad. They keep only digits, so a value like "5 people" is kept as 5 instead of being dropped by the browser. The review step lists every required field and marks any missing one, so nothing disappears silently.
- **ERO questions:** none comes pre-answered. Each starts on "Choose…", and continuing without a choice counts as skipped.
- **Blank first load:** the server logs show no error, and the page renders in full on the server. The likeliest cause is the browser losing the page's files while a new release was going out. The page now retries once on its own, then shows a "Reload the page" button instead of an empty screen. Answers in the tab are kept.
- **Saved draft:** the builder now restores a refreshed tab's answers. Before, it could overwrite the draft with the empty form before reading it.

## Owner decisions reflected

- **Privacy line:** the audit's line "Your results are private and never shared" now reads "Your results are saved privately to help us follow up, and never shared or sold". With lead capture, the results are stored.
- **Fee figure:** nothing is hardcoded. Each firm sets its own all-in fee per funded return as the WISP product setting `comparison_fee`. With no setting, the comparison isn't shown. Phase 3's fee schedules can feed it later.

## Setup (owner)

1. **Test project:** done. The migration is applied, and **the gate passed 12/12** (run by the owner in the SQL editor on 2026-10-13, rolled back with nothing left behind).
2. **The `wisp-assisted-build` product**, in Products:
   - set Product type to **Digital download** and Access type to **Instant download**;
   - add the product settings `delivery: wisp_generator` and `comparison_fee: 223` (your all-in fee per funded return, for the comparison);
   - add a description and an image;
   - create or verify the $25 Stripe price;
   - publish.
   - The store page for it then sends buyers to `/wisp`, and a bare checkout of it is refused.
3. **Preview emails:** they only reach addresses in `AUTOMATION_TEST_RECIPIENTS`.
4. **Production:** the migration needs approval, after the Forms and Archive migrations.
