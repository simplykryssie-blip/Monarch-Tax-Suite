"use client";

import { useEffect } from "react";

// If the WISP page fails to load (a dropped connection, or a new release replacing the page's files mid-load), try
// once more on its own, then offer a reload instead of leaving an empty screen. Answers saved in this tab survive.
export default function WispError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("wisp page failed to load", error.digest ?? error.message);
    let tried = false;
    try { tried = window.sessionStorage.getItem("wisp-retried") === "1"; window.sessionStorage.setItem("wisp-retried", "1"); } catch { /* storage unavailable */ }
    if (!tried) {
      const t = setTimeout(() => retry(), 300);
      return () => clearTimeout(t);
    }
  }, [error, retry]);

  return (
    <div className="wisp">
      <section className="section">
        <div className="container" style={{ textAlign: "center" }}>
          <h2 className="section-title">This page didn&apos;t finish loading</h2>
          <p className="section-sub">Please try again. Anything you already entered in this tab is kept.</p>
          <button type="button" className="btn btn-gold" onClick={() => {
            try { window.sessionStorage.removeItem("wisp-retried"); } catch { /* storage unavailable */ }
            window.location.reload();
          }}>Reload the page</button>
        </div>
      </section>
    </div>
  );
}
