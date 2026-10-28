"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { searchAction } from "@/app/(admin)/search-actions";
import type { SearchHit } from "@/lib/search.ts";
import { Icon } from "./icons";

/** ⌘K / Ctrl+K quick find across clients, leads, invoices and pages (and the store, on plans that have one). */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const run = useCallback((text: string) => {
    const mine = ++seq.current;
    start(async () => {
      const res = await searchAction(text);
      if (mine === seq.current) {
        setHits(res);
        setActive(0);
      }
    });
  }, []);

  const show = useCallback(() => {
    setQ("");
    setOpen(true);
    run("");
  }, [run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) setOpen(false);
        else show();
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, show]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => input.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => run(q), 160);
    return () => clearTimeout(t);
  }, [q, open, run]);

  const go = (h: SearchHit) => {
    setOpen(false);
    router.push(h.href);
  };

  const groups = hits.reduce<Record<string, SearchHit[]>>((acc, h) => ((acc[h.group] ??= []).push(h), acc), {});
  let index = -1;

  return (
    <>
      <button type="button" className="mt-search" onClick={show} aria-label="Search (Command K)">
        <Icon name="search" size={16} />
        <span>Search clients, invoices, pages…</span>
        <kbd>⌘K</kbd>
      </button>
      {open && (
        <div className="mt-pal-shade" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="mt-pal" role="dialog" aria-modal="true" aria-label="Search">
            <div className="mt-pal-input">
              <Icon name="search" size={18} />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search clients, invoices, pages…"
                aria-label="Search"
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                  else if (e.key === "Enter" && hits[active]) { e.preventDefault(); go(hits[active]); }
                }}
              />
              <kbd>esc</kbd>
            </div>
            <div className="mt-pal-list" aria-busy={pending}>
              {hits.length === 0 && <p className="mt-pal-empty">{q ? "No matches. Try a name, email, phone or invoice number." : "Start typing to search."}</p>}
              {Object.entries(groups).map(([group, items]) => (
                <div key={group}>
                  <div className="mt-pal-group">{group}</div>
                  {items.map((h) => {
                    index++;
                    const i = index;
                    return (
                      <button type="button" key={h.id} className={"mt-pal-item" + (i === active ? " is-active" : "")} onMouseEnter={() => setActive(i)} onClick={() => go(h)}>
                        <span><b>{h.title}</b><small>{h.detail}</small></span>
                        <Icon name="arrow" size={15} />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
