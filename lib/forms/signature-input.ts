import { MAX_SIGNATURE_PNG_BYTES } from "../documents/signing.ts";
import type { SignatureInput } from "./service.ts";

// The signature as the browser sends it (a drawn signature is a PNG data URL), turned into the service's input.

function pngFromDataUrl(v: string): Uint8Array | null {
  const m = v.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const bytes = Buffer.from(m[1], "base64");
  return bytes.byteLength <= MAX_SIGNATURE_PNG_BYTES ? new Uint8Array(bytes) : null;
}

export type SignaturePayload = { consent: boolean; signedName: string; method: "typed" | "drawn"; typed?: string; drawn?: string } | null;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export function signatureFrom(s: SignaturePayload): SignatureInput | null {
  if (!s) return null;
  const method = s.method === "drawn" ? "drawn" : "typed";
  return {
    consent: s.consent === true, signedName: str(s.signedName, 200), method,
    typed: method === "typed" ? str(s.typed, 120) : undefined,
    png: method === "drawn" ? pngFromDataUrl(str(s.drawn, 500_000)) ?? new Uint8Array() : undefined,
  };
}

