# Verexa HQ: policy decisions (owner's answers)

Decided by the owner on 2026-10-21. Companion to `docs/verexa-hq-policy-review.md` (numbering matches its decisions table). Final wording still needs counsel review before `PLATFORM_LEGAL_APPROVED` is set.

1. **Legal entity:** its own entity, formed in Louisiana; address 5520 Johnston Street, Lafayette, LA 70503 (virtual). Entity suffix (LLC / Inc.) to be confirmed with counsel.
2. **Refunds:** only a duplicate or double payment of the platform subscription. No partial-month refunds. Refunds stay manual in Stripe.
3. **Cancelling:** access continues to the end of the paid period.
4. **Plan changes:** customers can change plans. First payment after a change is the full new-plan monthly amount plus the prorated amount for the days left in the current cycle. **Open question: see "Open" below. Build not done.**
5. **Paused plan ($27):** contacts-only access, data preserved, full restore on resume.
6. **Failed payments:** read-only at once, Billing page fully working, retries and notices for at most about 14 days, then cancelled; 90-day retention from cancellation; paying within 90 days reactivates. **Built** (see below).
7. **Credits:** never refunded, transferred or exchanged, including accidental or duplicate purchases. Separate from the subscription both ways.
8. **Warranty, liability, disputes:** "as is"; liability capped at fees paid in the last 12 months; Louisiana law and venue. Plus: no relationship between Verexa HQ and customers' clients; the office owns its client relationships and indemnifies Verexa HQ against client claims; clients go to the office first.
9. **Changes to Terms:** 30 days' notice for material changes.
10. **Suspension for breach:** notify first and allow time to fix, except fraud, abuse or security risk.
11. **Data roles:** customers are controllers, Verexa HQ is processor; DPA available.
12. **SSNs:** encrypted, masked by default, authorised users only, access logged. No promise of the owner reveal screen.
13. **Providers:** Vercel, Supabase, Stripe, Resend, Twilio, Cloudflare. Production database is in a Canada region.
14. **After deletion:** invoices and payment records about 7 years; backups roll off within about 30 days.
15. **Privacy requests:** answered within 45 days.
16. **Account sharing / reselling:** own business only; offices under a Service Bureau count as that bureau's business.
17. **Enforcement:** email explanation and an appeal path answered within 5 business days; immediate action without warning only for illegal content, fraud or security risk.

Gap recommendations 1 to 6 approved (websites and Custom HTML; Pub. 1345 and Safeguards Rule; data export truth check; A2P 10DLC; bureau responsibility; provider-change notice).

## State in the code (branch `claude/policy-and-billing-rules`)

- Policy pages now carry these decisions. Still unpublished (`PLATFORM_LEGAL_APPROVED = false`). `[To confirm with counsel]` marks what counsel must settle.
- **Decision 6 built:** a failed renewal makes the workspace read-only at once (the Billing page, Security and sign-in keep working; no messages or automations run). The payment is retried daily, with reminders on day 7 and a final notice on day 12; the account is cancelled at day 14 and the 90-day clock starts. Old rows with status "suspended" are treated as read-only.
- **Gap 3 result: there is no complete data export in the product.** Only the single-return prep handoff exists. The Terms therefore do not promise an export, and the billing banner and emails no longer say "export". Either build a full export or leave the promise out.

## Open

- **Decision 4 charging rule needs one clarification** (is the unused part of the old plan credited?) and the build: portal plan switching is still off.
- Decision 7: the credit system should be checked to confirm a failed subscription payment never touches credit balances and the reverse (text credits exist; email credits may not).
- 90-day deletion job is not built yet (separate approval).
