"use client";

import { useState } from "react";

/** Desktop / mobile switch around a storefront view (admin preview only). */
export function DeviceFrame({ children }: { children: React.ReactNode }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  return (
    <>
      <div className="sf-device-toggle" role="group" aria-label="Preview device">
        <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}>Desktop</button>
        <button type="button" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}>Mobile</button>
      </div>
      <div className={`sf-frame is-${device}`}>{children}</div>
    </>
  );
}
