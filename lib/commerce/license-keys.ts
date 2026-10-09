import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// License keys look like MTS-XXXXX-XXXXX-XXXXX-XXXXX (100 random bits,
// Crockford base32). Only a SHA-256 hash and a short display prefix are
// stored; the full key is shown to the administrator once when issued.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const KEY_PATTERN = /^MTS(-[0-9A-HJKMNP-TV-Z]{5}){4}$/;

export function generateLicenseKey(): string {
  const bytes = randomBytes(20);
  let chars = "";
  for (const byte of bytes) chars += ALPHABET[byte & 31];
  return `MTS-${chars.slice(0, 5)}-${chars.slice(5, 10)}-${chars.slice(10, 15)}-${chars.slice(15, 20)}`;
}

export function normalizeLicenseKey(input: string): string {
  return input.trim().toUpperCase().replace(/[OIL]/g, (c) => (c === "O" ? "0" : "1"));
}

export function isWellFormedLicenseKey(key: string): boolean {
  return KEY_PATTERN.test(normalizeLicenseKey(key));
}

export function hashLicenseKey(key: string): string {
  return createHash("sha256").update(normalizeLicenseKey(key)).digest("hex");
}

export function licenseKeyPrefix(key: string): string {
  return normalizeLicenseKey(key).slice(0, 9);
}

export function licenseKeyMatches(key: string, storedHash: string): boolean {
  const a = Buffer.from(hashLicenseKey(key), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
