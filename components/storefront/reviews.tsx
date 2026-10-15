import { Stars } from "./stars";
import { BODY_MAX, BODY_MIN, summarize } from "@/lib/reviews/service.ts";
import type { Review } from "@/lib/reviews/types.ts";
import { postReviewAction } from "@/app/shop/[slug]/review-actions";

const day = (iso: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Chicago" }).format(new Date(iso));

/** Reviews on a product page: the average, each review, and the form for verified purchasers. */
export function Reviews({ slug, reviews, notice, error }: { slug: string; reviews: Review[]; notice?: string; error?: string }) {
  const s = summarize(reviews);
  return (
    <section className="sf-reviews" id="reviews" aria-labelledby="reviews-h">
      <h2 id="reviews-h">Reviews</h2>
      {s.count > 0 ? (
        <div className="sf-rsum">
          <div className="sf-ravg"><b>{s.average.toFixed(1)}</b><Stars value={s.average} size={20} /><small>{s.count} {s.count === 1 ? "review" : "reviews"}</small></div>
          <ul className="sf-rbars" aria-label="Ratings">
            {([5, 4, 3, 2, 1] as const).map((n) => (
              <li key={n}><span>{n} ★</span><i><b style={{ width: `${(s.stars[n] / s.count) * 100}%` }} /></i><span>{s.stars[n]}</span></li>
            ))}
          </ul>
        </div>
      ) : <p className="sf-rempty">No reviews yet. Bought this? Be the first to review it.</p>}

      <ul className="sf-rlist">
        {reviews.filter((r) => !r.hidden_at).map((r) => (
          <li key={r.id}>
            <div className="sf-rhead"><Stars value={r.rating} /><b>{r.display_name}</b><span className="sf-rverified">Verified buyer</span><small>{day(r.created_at)}</small></div>
            <p>{r.body}</p>
          </li>
        ))}
      </ul>

      <form action={postReviewAction} className="sf-rform">
        <h3>Write a review</h3>
        <p className="sf-rnote">Only people who bought this can review it. Enter the email you bought with and the order number from your receipt. Your review appears right away.</p>
        {notice && <p className="sf-rok" role="status">{notice}</p>}
        {error && <p className="sf-rerr" role="alert">{error}</p>}
        <input type="hidden" name="slug" value={slug} />
        <fieldset className="sf-rstars"><legend>Your rating *</legend>
          {[5, 4, 3, 2, 1].map((n) => <span key={n}><input type="radio" name="rating" id={`rate-${n}`} value={n} required /><label htmlFor={`rate-${n}`} title={`${n} star${n === 1 ? "" : "s"}`}>★<span className="sr-only"> {n} star{n === 1 ? "" : "s"}</span></label></span>)}
        </fieldset>
        <label>Your review *<textarea name="body" required minLength={BODY_MIN} maxLength={BODY_MAX} rows={5} placeholder="What did you use it for, and how did it go?" /></label>
        <label>Name to show (optional)<input name="display_name" maxLength={40} placeholder="Defaults to your first name and last initial" autoComplete="off" /></label>
        <div className="sf-rtwo">
          <label>Email you bought with *<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
          <label>Order number *<input name="order_number" required inputMode="numeric" maxLength={12} placeholder="e.g. 1042" autoComplete="off" /></label>
        </div>
        <button className="sf-rbtn">Post review</button>
      </form>
    </section>
  );
}
