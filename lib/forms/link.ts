import "server-only";
import { headers } from "next/headers";
import { formPublicUrl, hostFromHeaders } from "../brands.ts";
import { brandFor, type FormDeps } from "./service.ts";
import type { FormSettings } from "./settings.ts";

/**
 * A form's public link, built fresh from the request being served: in production the form's brand's web address
 * (when one is set), otherwise the host this request came in on. Never cached and never read from the environment,
 * so a Preview always shows its own address.
 */
export async function formLink(deps: FormDeps, publicId: string, settings: FormSettings): Promise<string> {
  const [brand, h] = await Promise.all([brandFor(deps, settings), headers()]);
  return formPublicUrl({ publicId, brand, requestHost: hostFromHeaders(h), production: process.env.VERCEL_ENV === "production" });
}
