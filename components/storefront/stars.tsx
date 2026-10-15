/** Read-only stars for a rating (0 to 5, halves shown as whole stars rounded). */
export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  const full = Math.round(value);
  return (
    <span className="sf-stars" role="img" aria-label={`${value.toFixed(1)} out of 5 stars`} style={{ fontSize: size }}>
      {[1, 2, 3, 4, 5].map((n) => <span key={n} className={n <= full ? "is-on" : undefined} aria-hidden="true">★</span>)}
    </span>
  );
}
