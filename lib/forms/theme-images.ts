import { legacyPathFromUrl, mediaPathFromUrl } from "../storage/paths.ts";
import type { FormTheme } from "./theme.ts";

// A form's logo and header image are files in the account's storage. When one is replaced or removed, or the form is
// deleted, its file is deleted too, unless another form still shows the same image (a duplicated form shares them).

type Images = Pick<FormTheme, "logo_url" | "header_image_url">;
const urls = (t: Images | null) => (t ? [t.logo_url, t.header_image_url].filter((u): u is string => !!u) : []);

/** Storage paths of this form's images that `after` no longer shows and no other form uses. */
export function staleThemeImages(tenantId: string, formId: string, before: Images, after: Images | null, others: Images[]): string[] {
  const keep = new Set([...urls(after), ...others.flatMap(urls)]);
  const id = formId.toLowerCase();
  const out: string[] = [];
  for (const url of urls(before)) {
    if (keep.has(url)) continue;
    const own = mediaPathFromUrl(url, tenantId);
    if (own?.startsWith(`images/forms/${id}/`)) out.push(own);
    const legacy = legacyPathFromUrl(url);
    if (legacy?.startsWith(`forms/${id}/`)) out.push(legacy);
  }
  return [...new Set(out)];
}
