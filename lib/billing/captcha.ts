// The "are you a person" check on signup, Cloudflare Turnstile. TURNSTILE_SITE_KEY goes to the browser; TURNSTILE_SECRET_KEY
// stays on the server. In production signup is closed without both. Elsewhere (Preview, local) a missing key skips the check
// so the flow can be tested.

export type CaptchaEnv = Record<string, string | undefined>;
export const captchaConfigured = (env: CaptchaEnv) => Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);

export async function verifyCaptcha(env: CaptchaEnv, token: string | null, ip: string | null, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!captchaConfigured(env)) return env.VERCEL_ENV !== "production";
  if (!token || token.length > 4096) return false;
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(8000) });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean };
    return res.ok && data.success === true;
  } catch {
    return false;
  }
}
