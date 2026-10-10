// Error text that reaches the database, logs or the UI must never carry secrets.
const PATTERNS: RegExp[] = [
  /\bre_[A-Za-z0-9_-]{8,}\b/g, // Resend API keys
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g, // Stripe keys
  /\bwhsec_[A-Za-z0-9]{8,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, // JWTs
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bMTS-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}\b/g, // license keys
  /([?&](?:t|token|code|state|key|secret|signature)=)[^&\s"']+/gi,
];

export function sanitizeError(input: unknown, max = 500): string {
  let text = input instanceof Error ? input.message : typeof input === "string" ? input : "Unknown error";
  for (const p of PATTERNS) text = text.replace(p, (_m, g1) => (typeof g1 === "string" ? `${g1}[redacted]` : "[redacted]"));
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || "Unknown error";
}
