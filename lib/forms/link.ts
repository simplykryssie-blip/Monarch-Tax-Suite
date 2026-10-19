import "server-only";
import { headers } from "next/headers";
import { formPublicUrl, hostFromHeaders } from "../brands.ts";
import { brandFor, type FormDeps } from "./service.ts";
import type { FormSettings } from "./settings.ts";

/**
 * A form's public link: the form's firm's own web address. Null when none is set (and the request is not on the
 * office's own domain): links never use a Vercel address.
 */
export async function formLink(deps: FormDeps, publicId: string, settings: FormSettings): Promise<string | null> {
  const [brand, h] = await Promise.all([brandFor(deps, settings), headers()]);
  return formPublicUrl({ publicId, brand, requestHost: hostFromHeaders(h) });
}
