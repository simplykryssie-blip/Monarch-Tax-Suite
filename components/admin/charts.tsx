import Link from "next/link";
import { niceTicks, type SeriesPoint } from "@/lib/dashboard-metrics.ts";

// Server-rendered SVG charts: no chart library, no client JavaScript. Single series in the logo gold on white,
// 2px line, recessive grid, and a hover/focus target with a native tooltip on every point. A data table
// summary is exposed to assistive technology through the aria-label.

type Fmt = (v: number) => string;

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const w = 110, h = 34, pad = 3;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [pad + (i * (w - pad * 2)) / Math.max(values.length - 1, 1), h - pad - (v / max) * (h - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const flat = values.every((v) => v === 0);
  const last = pts[pts.length - 1];
  return (
    <svg className="mt-spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <path d={flat ? `M${pad} ${h - pad} L${w - pad} ${h - pad}` : line} fill="none" stroke={flat ? "#d9d5c8" : "#2c6cbb"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {!flat && last && <circle cx={last[0]} cy={last[1]} r={3} fill="#fff" stroke="#2c6cbb" strokeWidth={2} />}
    </svg>
  );
}

export function AreaChart({ points, format, label }: { points: SeriesPoint[]; format: Fmt; label: string }) {
  const W = 680, H = 270, L = 52, R = 14, T = 14, B = 34;
  const max = Math.max(...points.map((p) => p.value), 0);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(points.length - 1, 1);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const summary = points.map((p) => `${p.label}: ${format(p.value)}`).join("; ");
  return (
    <svg className="mt-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}. ${summary}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
          <text x={L - 10} y={y(t) + 4} textAnchor="end">{format(t)}</text>
        </g>
      ))}
      <path d={line} fill="none" stroke="#2c6cbb" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={p.key}>
          {(i % 2 === 0 || points.length <= 7) && <text x={x(i)} y={H - 10} textAnchor="middle">{p.label}</text>}
          <circle className="hit" cx={x(i)} cy={y(p.value)} r={14} tabIndex={0}><title>{`${p.label}: ${format(p.value)}`}</title></circle>
          <circle className="dot" cx={x(i)} cy={y(p.value)} r={p.value > 0 ? 3.5 : 0} pointerEvents="none" />
        </g>
      ))}
    </svg>
  );
}

export function BarChart({ points, format, label }: { points: SeriesPoint[]; format: Fmt; label: string }) {
  const W = 380, H = 220, L = 30, R = 6, T = 12, B = 28;
  const ticks = niceTicks(Math.max(...points.map((p) => p.value), 0), 3, true);
  const top = ticks[ticks.length - 1] || 1;
  const slot = (W - L - R) / points.length;
  const bw = Math.min(16, slot * 0.5);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  return (
    <svg className="mt-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}. ${points.map((p) => `${p.label}: ${format(p.value)}`).join("; ")}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
          <text x={L - 8} y={y(t) + 4} textAnchor="end">{format(t)}</text>
        </g>
      ))}
      {points.map((p, i) => {
        const cx = L + slot * i + slot / 2;
        const h = Math.max(p.value > 0 ? 3 : 0, H - B - y(p.value));
        return (
          <g key={p.key}>
            {(i % 3 === 0 || points.length <= 6) && <text x={cx} y={H - 8} textAnchor="middle">{p.label.replace(/ \'\d\d$/, "")}</text>}
            <rect x={cx - bw / 2} y={H - B - h} width={bw} height={h} rx={4} fill="#0b0b0a" />
            <rect className="hit" x={cx - slot / 2} y={T} width={slot} height={H - T - B} tabIndex={0}><title>{`${p.label}: ${format(p.value)}`}</title></rect>
          </g>
        );
      })}
    </svg>
  );
}

export type BarRow = { label: string; value: number; note?: string; href?: string; tone?: "gold" | "ink" | "soft" };

/** Horizontal share bars (HTML): direct labels with values, so identity never depends on color alone. */
export function BarRows({ rows, total, empty }: { rows: BarRow[]; total?: number; empty: string }) {
  const sum = total ?? Math.max(...rows.map((r) => r.value), 0);
  if (!rows.some((r) => r.value > 0)) return <p className="monarch-muted">{empty}</p>;
  return (
    <div className="mt-bars">
      {rows.map((r) => {
        const body = (
          <>
            <span className="mt-bar-label">{r.label}</span>
            <span className="mt-bar-val">{r.value}</span>
            <span className="mt-bar-track" aria-hidden="true"><span className={"mt-bar-fill" + (r.tone === "ink" ? " is-ink" : r.tone === "soft" ? " is-soft" : "")} style={{ width: `${sum ? Math.max(r.value ? 3 : 0, (r.value / sum) * 100) : 0}%` }} /></span>
            {r.note && <span className="mt-bar-note">{r.note}</span>}
          </>
        );
        return r.href ? <Link key={r.label} className="mt-bar-row" href={r.href}>{body}</Link> : <div key={r.label} className="mt-bar-row">{body}</div>;
      })}
    </div>
  );
}

export type DonutSlice = { label: string; value: number; color: string; href?: string };

/** Ring chart with the total in the centre. The legend beside it repeats every value as text, so color is never the only cue. */
export function Donut({ slices, centre, caption }: { slices: DonutSlice[]; centre: string; caption: string }) {
  const total = slices.reduce((n, s) => n + s.value, 0);
  const R = 52, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="efin-donut">
      <svg viewBox="0 0 140 140" role="img" aria-label={`${caption}: ${slices.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
        <circle cx={70} cy={70} r={R} fill="none" stroke="#efefef" strokeWidth={14} />
        {total > 0 && slices.filter((s) => s.value > 0).map((s) => {
          const len = (s.value / total) * C;
          const seg = <circle key={s.label} cx={70} cy={70} r={R} fill="none" stroke={s.color} strokeWidth={14} strokeDasharray={`${Math.max(len - 2, 0.5)} ${C - Math.max(len - 2, 0.5)}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)"><title>{`${s.label}: ${s.value}`}</title></circle>;
          offset += len;
          return seg;
        })}
        <text x={70} y={68} textAnchor="middle" fontSize={26} fontWeight={700} fill="#111">{centre}</text>
        <text x={70} y={86} textAnchor="middle" fontSize={9.5} fill="#6b6b6b">{caption}</text>
      </svg>
      <ul>
        {slices.map((s) => (
          <li key={s.label}>
            <span className="efin-dot" style={{ background: s.color }} />
            {s.href ? <Link href={s.href}>{s.label}</Link> : <span>{s.label}</span>}
            <b>{s.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
