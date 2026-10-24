// How a person has arranged their Home: the order of the cards, each card's width and view (text or graph), and which are hidden.
// Pure, so it can be tested. The page keeps one of these per person in the browser for now (see components/home/home-grid.tsx).

export const SIZES = ["q", "h", "f"] as const;
export type Size = (typeof SIZES)[number];
export type View = "text" | "graph";
export type Layout = { order: string[] | null; size: Record<string, Size>; view: Record<string, View>; hidden: Record<string, boolean> };

export const EMPTY_LAYOUT: Layout = { order: null, size: {}, view: {}, hidden: {} };

const isSize = (v: unknown): v is Size => typeof v === "string" && (SIZES as readonly string[]).includes(v);
const isView = (v: unknown): v is View => v === "text" || v === "graph";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads what was saved, ignoring anything that isn't the right shape, so a damaged or older value never breaks Home. */
export function parseLayout(raw: string | null | undefined): Layout {
  if (!raw) return EMPTY_LAYOUT;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return EMPTY_LAYOUT; }
  if (!isRecord(v)) return EMPTY_LAYOUT;
  const order = Array.isArray(v.order) ? v.order.filter((x): x is string => typeof x === "string").slice(0, 100) : null;
  const size: Record<string, Size> = {};
  const view: Record<string, View> = {};
  const hidden: Record<string, boolean> = {};
  if (isRecord(v.size)) for (const [k, s] of Object.entries(v.size)) if (isSize(s)) size[k] = s;
  if (isRecord(v.view)) for (const [k, s] of Object.entries(v.view)) if (isView(s)) view[k] = s;
  if (isRecord(v.hidden)) for (const [k, s] of Object.entries(v.hidden)) if (s === true) hidden[k] = true;
  return { order, size, view, hidden };
}

/**
 * The saved order applied to the cards that exist today. A saved card that no longer exists is dropped; a card that is new
 * (not in the saved order) goes at the end, so nothing ever vanishes because the layout is out of date.
 */
export function applyLayout(allIds: string[], layout: Layout): { order: string[]; visible: string[]; hiddenIds: string[] } {
  const known = new Set(allIds);
  const saved = (layout.order ?? []).filter((id) => known.has(id));
  const order = layout.order ? [...saved, ...allIds.filter((id) => !saved.includes(id))] : allIds;
  return { order, visible: order.filter((id) => !layout.hidden[id]), hiddenIds: order.filter((id) => layout.hidden[id]) };
}

/** Moves `from` to sit just before `to`. */
export function dropBefore(order: string[], from: string, to: string): string[] {
  if (from === to || !order.includes(from) || !order.includes(to)) return order;
  const rest = order.filter((id) => id !== from);
  rest.splice(rest.indexOf(to), 0, from);
  return rest;
}

/** Swaps a card with the visible card before (-1) or after (+1) it, leaving hidden cards where they are. */
export function moveBy(order: string[], visible: string[], id: string, dir: -1 | 1): string[] {
  const at = visible.indexOf(id);
  const other = visible[at + dir];
  if (at < 0 || other === undefined) return order;
  const next = order.slice();
  const a = next.indexOf(id);
  const b = next.indexOf(other);
  next[a] = other;
  next[b] = id;
  return next;
}
