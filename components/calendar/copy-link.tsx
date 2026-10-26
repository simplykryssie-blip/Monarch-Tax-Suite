"use client";

import { useState } from "react";

/** Copies a link to the clipboard and says so. */
export function CopyLink({ href, label = "Copy booking link", className = "monarch-secondary" }: { href: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={className} onClick={() => {
      const url = href.startsWith("/") ? `${window.location.origin}${href}` : href;
      navigator.clipboard?.writeText(url).then(() => { setDone(true); setTimeout(() => setDone(false), 2000); }, () => undefined);
    }}>{done ? "Copied" : label}</button>
  );
}
