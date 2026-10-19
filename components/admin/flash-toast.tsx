"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";

/** Result banner from a server action (?notice= / ?error=). Dismissable; success messages fade after a few seconds. */
export function FlashToast({ notice, error }: { notice?: string; error?: string }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!notice || error) return;
    const t = setTimeout(() => setGone(true), 8000);
    return () => clearTimeout(t);
  }, [notice, error]);
  if (gone || (!notice && !error)) return null;
  return (
    <div className={"mt-flash" + (error ? " is-error" : "")} role={error ? "alert" : "status"}>
      <Icon name={error ? "support" : "check"} size={18} />
      <span>{error ?? notice}</span>
      <button type="button" onClick={() => setGone(true)} aria-label="Dismiss">×</button>
    </div>
  );
}
