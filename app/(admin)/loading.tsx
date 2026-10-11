// Shown while an admin page loads: the page's own shape in soft shimmer, so the screen never jumps or blanks.
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mt-skel" style={{ height: 18, width: 180, marginBottom: 14 }} />
      <div className="mt-skel" style={{ height: 40, width: 320, marginBottom: 26 }} />
      <div className="mt-kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="mt-skel" style={{ height: 150, borderRadius: 14 }} />)}</div>
      <div className="mt-grid-2"><div className="mt-skel" style={{ height: 320, borderRadius: 14 }} /><div className="mt-skel" style={{ height: 320, borderRadius: 14 }} /></div>
    </div>
  );
}
