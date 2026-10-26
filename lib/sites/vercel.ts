import { ValidationError } from "../commerce/validation.ts";
import type { DomainsPort } from "./service.ts";

// Custom domains are attached to the hosting project through Vercel's API. The token and project id are server
// settings (VERCEL_API_TOKEN, VERCEL_PROJECT_ID, optionally VERCEL_TEAM_ID); they are never shown or logged.

export type VercelEnv = Record<string, string | undefined>;
type Fetch = typeof fetch;

export function vercelProblems(env: VercelEnv): string[] {
  const p: string[] = [];
  if (!env.VERCEL_API_TOKEN) p.push("VERCEL_API_TOKEN is not set.");
  if (!env.VERCEL_PROJECT_ID) p.push("VERCEL_PROJECT_ID is not set.");
  return p;
}

type Verification = { type: string; domain: string; value: string; reason?: string };
const verificationOf = (v: unknown): Verification[] => (Array.isArray(v) ? v.filter((x): x is Verification => !!x && typeof x === "object" && typeof (x as Verification).type === "string").map((x) => ({ type: x.type, domain: String(x.domain), value: String(x.value), reason: x.reason ? String(x.reason) : undefined })) : []);

export function vercelDomains(env: VercelEnv = process.env, fetcher: Fetch = fetch): DomainsPort | null {
  if (vercelProblems(env).length) return null;
  const token = env.VERCEL_API_TOKEN!;
  const project = encodeURIComponent(env.VERCEL_PROJECT_ID!);
  const team = env.VERCEL_TEAM_ID ? `teamId=${encodeURIComponent(env.VERCEL_TEAM_ID)}` : "";
  const url = (path: string) => `https://api.vercel.com${path}${team ? (path.includes("?") ? "&" : "?") + team : ""}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetcher(url(path), { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { code?: string; message?: string } };
    return { status: res.status, ok: res.ok, json };
  };
  return {
    async add(host) {
      const r = await call("POST", `/v10/projects/${project}/domains`, { name: host });
      if (!r.ok) {
        const code = r.json.error?.code ?? "";
        if (r.status === 409 || /domain_already_in_use|domain_taken|domain_conflict/.test(code)) throw new ValidationError("That domain is already attached at the website host (to another account or service), so it can't be connected here yet. If it is yours, remove it from there first, or ask the platform administrator.");
        if (r.status === 400) throw new ValidationError("The website host doesn't accept that domain. Check the spelling.");
        throw new Error(`vercel add domain ${r.status} ${code}`);
      }
      return { verified: r.json.verified === true, verification: verificationOf(r.json.verification) };
    },
    async check(host) {
      const d = await call("GET", `/v9/projects/${project}/domains/${encodeURIComponent(host)}`);
      if (d.status === 404) return null;
      if (!d.ok) throw new Error(`vercel get domain ${d.status}`);
      const c = await call("GET", `/v6/domains/${encodeURIComponent(host)}/config`);
      return { verified: d.json.verified === true, verification: verificationOf(d.json.verification), misconfigured: c.ok ? c.json.misconfigured === true : true };
    },
    async remove(host) {
      const r = await call("DELETE", `/v9/projects/${project}/domains/${encodeURIComponent(host)}`);
      if (!r.ok && r.status !== 404) throw new Error(`vercel remove domain ${r.status}`);
    },
  };
}
