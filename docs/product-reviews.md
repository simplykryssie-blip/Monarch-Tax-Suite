# Product reviews

A star rating (1 to 5) and a written review (10 to 2,000 characters) on each product page (`/shop/<slug>#reviews`), **live as soon as it is posted**, from **verified purchasers only**.

- **Verified:** the reviewer enters the email they bought with and the order number from their receipt. Both must match a **paid** order for **this product** (refunded and other products' orders don't count). Every failure gives the same message, so the form never reveals whether an email or order exists. Limited per visitor.
- **One review per customer per product.** The name shown defaults to first name and last initial ("Casey C."); the reviewer can choose another. Reviews are plain text (markup is shown, never run).
- **Shown:** the average (one decimal), a count per star, each review with a "Verified buyer" tag, and the average on the shop list.
- **Moderation:** an administrator can hide a review from the product's admin page (Products > the product > Reviews). It is kept, with the reason, and can be shown again. Hidden reviews don't count toward the average.
- **Data:** `product_reviews` (migration `20261028090000_product_reviews.sql`), with `tenant_id` and the standard two policies from day one, and same-tenant keys to the product, customer and order. Without the migration the product page simply shows no reviews section.
