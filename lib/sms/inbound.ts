import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { appOrigin } from "../admin";
import { CrmSecrets } from "../crm/crypto.ts";

// Where replies to a texting number are sent. The address carries a signature only this server can make, so nobody else can
// post fake STOP replies. It is the same for every office; the office is found from the number the text was sent to.

function key(): Buffer {
  const s = CrmSecrets.fromBase64(process.env.MONARCH_ENCRYPTION_KEY);
  if (!s) throw new Error("MONARCH_ENCRYPTION_KEY is not configured.");
  return Buffer.from(s.hashIdentifier("campaign-link-key", "v1"), "hex");
}
export const inboundSignature = () => createHmac("sha256", key()).update("sms-inbound:v1").digest("base64url");
export const inboundSignatureOk = (given: string) => {
  const want = inboundSignature();
  return want.length === given.length && timingSafeEqual(Buffer.from(want), Buffer.from(given));
};
export async function inboundUrl(): Promise<string> {
  return `${await appOrigin()}/api/sms/inbound/${inboundSignature()}`;
}
/** The address numbers are pointed at: production only (a Preview or local run never repoints a real number), and only when the key is set. */
export async function inboundUrlForNumbers(): Promise<string | null> {
  if (process.env.VERCEL_ENV !== "production") return null;
  try {
    return await inboundUrl();
  } catch {
    return null;
  }
}
