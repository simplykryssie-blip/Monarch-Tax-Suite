export const metadata = { title: "Page not found", robots: { index: false, follow: false } };

export default function SiteNotFound() {
  return (
    <main style={{ font: "16px/1.6 system-ui, sans-serif", maxWidth: 520, margin: "20vh auto", padding: "0 16px", textAlign: "center" }}>
      <h1 style={{ fontSize: 28 }}>This page isn&apos;t available</h1>
      <p>The address may be misspelled, or the website hasn&apos;t been published yet.</p>
    </main>
  );
}
