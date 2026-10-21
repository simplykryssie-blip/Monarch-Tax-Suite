"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// A site owner's own HTML, CSS and script, shown in a frame of its own. The sandbox has no "allow-same-origin", so the code
// runs as a separate, empty origin: it can't read the platform's cookies, storage or sign-in, and can't call the platform as
// the visitor. It may run script, submit its own forms and open links in a new tab. The frame reports its content height so
// the block fits what was pasted.

const RESIZE = `<script>(function(){var s=function(){parent.postMessage({wsHtmlHeight:Math.ceil(document.documentElement.scrollHeight)},"*")};addEventListener("load",s);if(window.ResizeObserver)new ResizeObserver(s).observe(document.documentElement);else setInterval(s,500)})()</script>`;

export function frameDocument(code: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>html,body{margin:0}body{font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;overflow-x:hidden}img,video,iframe{max-width:100%}</style></head><body>${code}${RESIZE}</body></html>`;
}

export function HtmlEmbed({ code, height }: { code: string; height: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(height);
  const doc = useMemo(() => frameDocument(code), [code]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return;
      const n = Number((e.data as { wsHtmlHeight?: unknown } | null)?.wsHtmlHeight);
      if (Number.isFinite(n) && n > 0) setH(Math.min(5000, Math.max(40, Math.round(n))));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={ref}
      className="ws-frame"
      title="Custom content"
      sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={doc}
      style={{ height: h, margin: 0 }}
      loading="lazy"
    />
  );
}
