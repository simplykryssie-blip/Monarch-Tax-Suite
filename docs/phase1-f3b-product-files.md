# Phase 1, step F3b: product files (code bundles), stored and delivered, never executed

Owner requirement, 2026-10-11: when the platform opens to other sellers, they need somewhere to put their own coded software. **Sellers upload files; the platform stores them and delivers them to licensed buyers; the platform never runs them.** The Monarch tax calculator stays built in.

## Security boundary

| Rule | How it is enforced |
|---|---|
| Files are never executed or rendered by the platform | Every object is stored as `application/octet-stream`; the bucket accepts nothing else. An upload that landed as anything else (for example `text/html`) is deleted and refused. |
| Never public | The `product-files` bucket is private, and no storage policies exist, so only the server (service role) can upload, sign or delete. No code calls `getPublicUrl` on it. |
| No platform page serves uploaded code | Buyers are redirected to a Supabase Storage signed URL that expires in **60 seconds** and forces a download (`Content-Disposition: attachment`, the original file name). No app route reads or streams file contents. |
| Only licensed buyers | Each list and each click re-checks the license key: active license, paid order, and the file must belong to that license's product. Wrong keys, suspended or revoked licenses, refunded orders, other products' files, and pending or removed files get nothing, and no URL is signed. |
| Logged | Every download is recorded per license: file, time, and a keyed hash of the visitor (no IP address). It shows on the License page and as counts on the Product page. |
| Brute-force | Key lookups and downloads are limited to 20 per visitor per minute. |

## What sellers (today: the owner) do

On a product's admin page, the **Product files** panel uploads files:
- Allowed types: `.zip`, `.html`, `.js`, `.css`. Anything else goes inside a `.zip`.
- Limits: up to 50 MB per file, 200 MB and 20 files per product.
- The browser sends the file straight to private storage with a one-time URL, because server actions are capped at 4.5 MB. The server then confirms the stored size and type before the file becomes available.
- **Remove** stops downloads and deletes the stored file; the download history is kept.

## What buyers do

They open `/downloads`, enter their license key, and download each file. They install and host the code themselves, following the seller's instructions in the product description.

## Not in this step

- **Separate seller admins.** Products and the admin are owner-only today, and seller accounts are Phase 2. Files belong to a product, so a seller's admin can reuse this as is, scoped to that seller's products.
- **Digital downloads without a license** (`instant_download` access) stay unpublishable. Downloads are gated on a license, so sell code bundles as **Software with License access**. A license-free entitlement for documents can come later.
- **Linking `/downloads` from the purchase emails.** That's part of the workflow and email review (plan step 7). Until then, give buyers the link along with their key.
- Sandboxed embeds of seller code are out of scope, as decided.
- The built-in calculator is unchanged: same embed, licensing and updates. Its product page simply shows an empty Product files panel.

## Rollout

1. Apply `supabase/migrations/20261013100000_product_files.sql` to production. It's already on the test project, verified as private, 50 MB limit, octet-stream only. Until it's applied, the Product files panel and `/downloads` show "not available" notices; nothing else is affected.
2. Merge.

## Test evidence (`npm test`, 315 passing; new cases in `tests/product-files.test.ts`)

| Test case | Expected | Actual |
|---|---|---|
| File names | Only .zip/.html/.js/.css; path parts stripped; unsafe characters replaced; .exe, .php, .svg, .htm refused | Pass |
| Upload ticket | Pending record, random object name under the product, octet-stream content type | Pass |
| Limits | 50 MB per file, 200 MB and 20 files per product, empty files and archived products refused | Pass |
| Upload confirmation | Missing object refused; non-octet-stream object deleted and refused; size mismatch refused; correct upload becomes ready | Pass |
| Licensed download | Active, paid license lists and downloads its files; signed URL forces the file name, 60 seconds; download logged with license and client hash | Pass |
| Refusals | Malformed or unknown key, suspended license, refunded order: no listing, no signed URL, no log | Pass |
| Isolation | Another product's file, a pending file, a removed file: refused | Pass |
| Boundary (static) | Bucket private and octet-stream only; no `getPublicUrl`; downloads only by redirect to a signed URL; no route streams file contents | Pass |
| Built-in calculator and all earlier suites | Unchanged | Pass |
