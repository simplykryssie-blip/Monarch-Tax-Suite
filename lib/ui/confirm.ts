// Which buttons must ask before they run. One rule for the whole app, so a destructive button added later is covered without
// anyone remembering to wire it: a submit button asks when its label starts with one of these words, or when it is styled
// as dangerous. Pure, so it can be tested.

const ASKS = /^(delete|remove|archive|restore|void|discard|revoke|disconnect|withdraw|take offline|unpublish|cancel (?:the )?(?:invite|request|subscription|campaign|send))\b/i;
const PERMANENT = /^(delete|remove|void|discard|revoke|disconnect)\b/i;

export type ConfirmKind = "permanent" | "normal";

/** Whether a submit button with this label asks first, and how seriously. Null means it just runs. */
export function confirmKind(label: string, styledDanger: boolean): ConfirmKind | null {
  const text = label.replace(/\s+/g, " ").trim();
  if (!text) return styledDanger ? "normal" : null;
  if (PERMANENT.test(text)) return "permanent";
  if (ASKS.test(text) || styledDanger) return "normal";
  return null;
}

/** The sentence shown in the dialog. A page can supply its own wording with data-confirm on the button or form. */
export function confirmText(label: string, kind: ConfirmKind): string {
  const verb = label.replace(/\s+/g, " ").trim().replace(/[.…]+$/, "");
  const lower = verb ? verb.charAt(0).toLowerCase() + verb.slice(1) : "do this";
  return kind === "permanent" ? `Are you sure you want to ${lower}? This cannot be undone.` : `Are you sure you want to ${lower}?`;
}
