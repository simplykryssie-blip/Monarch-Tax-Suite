import { finishMoney, formatMoney } from "./ids.ts";

const ALLOWED = /^[\d.,$()\s\-−]*$/;

/**
 * Shapes a dollar amount as it is typed: $1,234.50, or -$1,234.50 when it starts with a minus (money the client owes).
 * Text that is not an amount (letters) is left exactly as typed, so the server can refuse it instead of it being erased.
 */
export function shapeMoney(v: string, allowNegative: boolean, finish = false): string {
  if (!ALLOWED.test(v)) return v;
  const negative = allowNegative && /^[\s$]*[-−(]/.test(v);
  const body = (finish ? finishMoney : formatMoney)(v.replace(/[-−()]/g, ""));
  if (negative) return body ? `-${body}` : "-";
  return body;
}

