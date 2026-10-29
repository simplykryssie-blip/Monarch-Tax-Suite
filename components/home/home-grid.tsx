"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { RANGES, type HomeData, type Range, type StatCard, type Tone } from "@/lib/home/model.ts";
import { applyLayout, dropBefore, EMPTY_LAYOUT, moveBy, parseLayout, SIZES, type Layout, type Size } from "@/lib/home/layout.ts";

const dollars = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
const TONE: Record<Tone, string> = { good: "hm-good", warn: "hm-warn", bad: "hm-bad", plain: "hm-plain" };
const SIZE_LABEL: Record<Size, string> = { q: "¼", h: "½", f: "Full" };

// The arrangement lives in this browser's storage. It is read through useSyncExternalStore so the first render matches the
// server's (the default layout) and then switches to the saved one; if storage is blocked, it is kept in memory for the visit.
const listeners = new Set<() => void>();
const memory = new Map<string, string>();
const subscribe = (cb: () => void) => { listeners.add(cb); window.addEventListener("storage", cb); return () => { listeners.delete(cb); window.removeEventListener("storage", cb); }; };
const readStore = (key: string): string | null => { try { return window.localStorage.getItem(key) ?? memory.get(key) ?? null; } catch { return memory.get(key) ?? null; } };
const writeStore = (key: string, value: string) => { memory.set(key, value); try { window.localStorage.setItem(key, value); } catch { /* kept in memory for this visit */ } listeners.forEach((f) => f()); };

type Widget = { id: string; title: string; size: Size; graph: boolean; body: (view: "text" | "graph") => React.ReactNode };

function Bars({ values, label, format }: { values: number[]; label: string; format: (n: number) => string }) {
  const max = Math.max(...values, 1);
  return (
    <div role="img" aria-label={`${label}: ${values.map(format).join(", ")}`} className="hm-bars">
      {values.map((v, i) => <span key={i} style={{ height: `${Math.max(6, Math.round((v / max) * 100))}%` }} title={format(v)} />)}
    </div>
  );
}

function StatBody({ s, range, view }: { s: StatCard; range: Range; view: "text" | "graph" }) {
  const n = s.ranged ? s.ranged[range] : s.value;
  const text = s.kind === "money" ? dollars(n) : String(n);
  return (
    <div className="hm-stat">
      <Link href={s.href} className="hm-stat-label">{s.label} &rsaquo;</Link>
      <strong>{text}</strong>
      <span className={TONE[s.tone]}>{s.sub}</span>
      {view === "graph" && s.series && (
        <>
          <Bars values={s.series} label={`${s.label}, last 7 days`} format={(v) => (s.kind === "money" ? dollars(v) : String(v))} />
          <small className="hm-muted">Last 7 days</small>
        </>
      )}
    </div>
  );
}

/** Home: cards you can rearrange, resize, switch between text and a graph, and hide. The arrangement is kept in this browser. */
export function HomeGrid({ data, storageKey }: { data: HomeData; storageKey: string }) {
  const [range, setRange] = useState<Range>("month");
  const raw = useSyncExternalStore(subscribe, () => readStore(storageKey), () => null);
  const layout = useMemo(() => parseLayout(raw), [raw]);
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);

  const save = (next: Layout) => writeStore(storageKey, JSON.stringify(next));

  const widgets: Widget[] = useMemo(() => {
    const list: Widget[] = [];
    list.push({ id: "season", title: "Filing season", size: "f", graph: false, body: () => (
      <div className="hm-season">
        <div><b>{data.season.title}</b><span className="hm-muted">{data.season.sub}</span></div>
        <div><div className="hm-progress" role="img" aria-label={`${data.season.pct} percent filed`}><span style={{ width: `${data.season.pct}%` }} /></div><small className="hm-muted">{data.season.note}</small></div>
      </div>
    ) });
    for (const s of data.stats) list.push({ id: `s:${s.id}`, title: s.label, size: "q", graph: s.series !== null, body: (view) => <StatBody s={s} range={range} view={view} /> });
    list.push({ id: "priorities", title: "Today’s priorities", size: "h", graph: false, body: () => (
      <>
        <div className="hm-head"><b>Today&apos;s priorities</b><span className="hm-muted">Ranked by fixed rules: how overdue, then what is due today. Each row says why it is here.</span></div>
        {data.priorities.length === 0 ? <p className="hm-empty">Nothing urgent. You are caught up.</p> : data.priorities.map((p) => (
          <Link key={p.id} href={p.href} className="hm-row">
            <span className="hm-rank" aria-hidden="true">{p.rank}</span>
            <span className="hm-main"><b>{p.who}</b><small className="hm-muted">{p.what}</small></span>
            <span className={`hm-chip ${TONE[p.tone]}`}>{p.why}</span>
          </Link>
        ))}
      </>
    ) });
    list.push({ id: "agenda", title: "Today and tomorrow", size: "h", graph: false, body: () => (
      <>
        <div className="hm-head"><b>Today and tomorrow</b><Link href="/calendar" className="hm-link">Open calendar</Link></div>
        <p className="hm-sub">Today</p>
        {data.today.length === 0 ? <p className="hm-empty">Nothing scheduled.</p> : data.today.map((a) => <div key={a.id} className="hm-row"><b className="hm-time">{a.time}</b><span className="hm-main">{a.title}<small className="hm-muted">{a.who}</small></span></div>)}
        <p className="hm-sub">Tomorrow</p>
        {data.tomorrow.length === 0 ? <p className="hm-empty">Nothing scheduled.</p> : data.tomorrow.map((a) => <div key={a.id} className="hm-row"><b className="hm-time">{a.time}</b><span className="hm-main">{a.title}<small className="hm-muted">{a.who}</small></span></div>)}
      </>
    ) });
    for (const p of data.panels) list.push({ id: `p:${p.id}`, title: p.title, size: "h", graph: false, body: () => (
      <>
        <div className="hm-head"><span><b>{p.title}</b><small className="hm-muted">{p.sub}</small></span><Link href={p.href} className="hm-link">{p.link}</Link></div>
        {p.rows.length === 0 ? <p className="hm-empty">Nothing here right now.</p> : p.rows.map((r) => (
          <Link key={r.id} href={r.href} className="hm-row">
            <span className="hm-main"><b>{r.a}</b><small className="hm-muted">{r.b}</small></span>
            <span className={`hm-chip ${TONE[r.tone]}`}>{r.chip}</span>
          </Link>
        ))}
      </>
    ) });
    const max = Math.max(...data.pipeline.map((s) => s.count), 1);
    list.push({ id: "pipeline", title: "Returns by stage", size: "f", graph: true, body: (view) => (
      <div className="hm-pipe">
        <div className="hm-head"><b>Returns by stage</b></div>
        {view === "graph" ? (
          <div className="hm-cols" role="img" aria-label={`Returns by stage: ${data.pipeline.map((s) => `${s.label} ${s.count}`).join(", ")}`}>
            {data.pipeline.map((s) => <div key={s.id}><b>{s.count}</b><span style={{ height: `${Math.max(4, Math.round((s.count / max) * 100))}%`, background: s.color }} /><small className="hm-muted">{s.label}</small></div>)}
          </div>
        ) : (
          <>
            <div className="hm-stack" role="img" aria-label="Returns by stage">{data.pipeline.map((s) => <span key={s.id} style={{ flex: Math.max(s.count, 0.0001), background: s.color }} />)}</div>
            <div className="hm-legend">{data.pipeline.map((s) => <span key={s.id}><b>{s.count}</b> {s.label}</span>)}</div>
          </>
        )}
      </div>
    ) });
    return list;
  }, [data, range]);

  const { order, visible, hiddenIds } = applyLayout(widgets.map((w) => w.id), layout);
  const byId = new Map(widgets.map((w) => [w.id, w]));

  return (
    <>
      <div className="hm-controls">
        <div role="group" aria-label="Date range" className="hm-seg">
          {RANGES.map((r) => <button key={r.key} type="button" aria-pressed={range === r.key} className={range === r.key ? "is-on" : undefined} onClick={() => setRange(r.key)}>{r.label}</button>)}
        </div>
        <div className="hm-actions">
          {editing && <button type="button" className="monarch-secondary" onClick={() => save(EMPTY_LAYOUT)}>Reset to default</button>}
          <button type="button" className={editing ? "monarch-primary" : "monarch-secondary"} aria-pressed={editing} onClick={() => { setEditing((e) => !e); setDrag(null); }}>{editing ? "Done" : "Edit layout"}</button>
        </div>
      </div>

      {editing && (
        <div className="hm-edit-note" role="note">
          <span><b>Edit layout.</b> Drag a card by its handle, or use the arrows. Choose a width, switch a card between text and a graph where it has one, or hide it. Changes are kept in this browser.</span>
          {hiddenIds.length > 0 && <span className="hm-hidden">Hidden: {hiddenIds.map((id) => <button key={id} type="button" onClick={() => save({ ...layout, hidden: { ...layout.hidden, [id]: false } })}>+ {byId.get(id)?.title ?? id}</button>)}</span>}
        </div>
      )}

      <div className="hm-grid">
        {visible.map((id) => {
          const w = byId.get(id);
          if (!w) return null;
          const size = layout.size[id] ?? w.size;
          const view = w.graph ? (layout.view[id] ?? "text") : "text";
          return (
            <div
              key={id}
              className={`monarch-panel hm-card hw-${size}${editing ? " is-editing" : ""}${drag === id ? " is-dragging" : ""}`}
              draggable={editing}
              onDragStart={(e) => { setDrag(id); try { e.dataTransfer.setData("text/plain", id); } catch { /* ignore */ } }}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => { if (editing && drag) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (drag && drag !== id) save({ ...layout, order: dropBefore(order, drag, id) }); setDrag(null); }}
            >
              {editing && (
                <div className="hm-bar">
                  <span className="hm-grip" aria-hidden="true" title="Drag to move">&#8942;&#8942;</span>
                  <b>{w.title}</b>
                  <button type="button" aria-label={`Move ${w.title} earlier`} onClick={() => save({ ...layout, order: moveBy(order, visible, id, -1) })}>&larr;</button>
                  <button type="button" aria-label={`Move ${w.title} later`} onClick={() => save({ ...layout, order: moveBy(order, visible, id, 1) })}>&rarr;</button>
                  <span role="group" aria-label={`Width of ${w.title}`} className="hm-seg hm-mini">{SIZES.map((sz) => <button key={sz} type="button" aria-pressed={size === sz} className={size === sz ? "is-on" : undefined} onClick={() => save({ ...layout, size: { ...layout.size, [id]: sz } })}>{SIZE_LABEL[sz]}</button>)}</span>
                  {w.graph && <span role="group" aria-label={`View of ${w.title}`} className="hm-seg hm-mini">{(["text", "graph"] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} className={view === v ? "is-on" : undefined} onClick={() => save({ ...layout, view: { ...layout.view, [id]: v } })}>{v === "text" ? "Text" : "Graph"}</button>)}</span>}
                  <button type="button" className="hm-hide" onClick={() => save({ ...layout, hidden: { ...layout.hidden, [id]: true } })}>Hide</button>
                </div>
              )}
              {w.body(view)}
            </div>
          );
        })}
      </div>
    </>
  );
}
