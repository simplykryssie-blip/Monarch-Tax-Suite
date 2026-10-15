import { Stars } from "@/components/storefront/stars";
import { summarize } from "@/lib/reviews/service.ts";
import type { Review } from "@/lib/reviews/types.ts";
import { hideReviewAction } from "@/app/(admin)/products/[id]/review-actions";

/** A product's reviews for the administrator, including hidden ones. Reviews go live at once; this is where one is taken down. */
export function ReviewsPanel({ productId, reviews }: { productId: string; reviews: Review[] }) {
  const s = summarize(reviews);
  return (
    <section className="monarch-panel" style={{ padding: 20 }}>
      <h2>Reviews</h2>
      <p className="monarch-muted">{s.count ? <>{s.average.toFixed(1)} average from {s.count} visible {s.count === 1 ? "review" : "reviews"}. </> : "No visible reviews. "}Reviews come only from verified buyers and are live as soon as they are posted. Hide one that breaks your rules; it is kept.</p>
      {reviews.length === 0 ? <p className="monarch-muted">No reviews yet.</p> : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
          {reviews.map((r) => (
            <li key={r.id} style={{ borderTop: "1px solid #e3dfd2", paddingTop: 10, opacity: r.hidden_at ? 0.6 : 1 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}><Stars value={r.rating} /><b>{r.display_name}</b><small className="monarch-muted">{new Date(r.created_at).toLocaleDateString("en-US")}</small>{r.hidden_at && <span className="monarch-badge inactive">Hidden{r.hidden_reason ? `: ${r.hidden_reason}` : ""}</span>}</div>
              <p style={{ whiteSpace: "pre-wrap", margin: "6px 0" }}>{r.body}</p>
              <form action={hideReviewAction} className="monarch-inline-form" style={{ flexWrap: "wrap" }}>
                <input type="hidden" name="id" value={r.id} /><input type="hidden" name="product_id" value={productId} /><input type="hidden" name="hide" value={r.hidden_at ? "no" : "yes"} />
                {!r.hidden_at && <input name="reason" placeholder="Why (optional)" maxLength={300} aria-label="Reason for hiding" />}
                <button className="monarch-secondary efin-small">{r.hidden_at ? "Show again" : "Hide"}</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
