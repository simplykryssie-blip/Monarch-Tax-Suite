import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { appOrigin } from "../admin";
import { loadBrand } from "../branding/server";
import { mfaState, sendOfficeEmail } from "../office/server";
import { practiceMfaGate } from "../practice/mfa.ts";
import { createClient } from "../supabase/server";
import { platformClient, tenantClient } from "../supabase/service";
import { SupabaseDocumentStore } from "../documents/supabase-repo.ts";
import { SupabasePortalDocsRepo, SupabasePortalStaffRepo } from "./docs-supabase.ts";
import { notify } from "../notifications/server";
import { portalUploadNotice } from "./activity.ts";
import type { PortalDocDeps } from "./documents.ts";
import { PortalReader } from "./reader.ts";
import type { PortalMember, PortalMemberRepo } from "./service.ts";
import { SupabasePortalMemberRepo } from "./supabase-repo.ts";

// Server wiring for the client portal. Each request finds who is signed in and which offices they are a client of (one
// logged platform lookup, since the tenant isn't known until then). Everything after that acts as one office, and the
// reader is built for exactly one client of it: a portal page cannot ask for another client's rows.

export const PORTAL_COOKIE = "monarch_portal_office";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const portalMemberRepo = (tenantId: string): PortalMemberRepo => new SupabasePortalMemberRepo(tenantClient(tenantId));
export const portalReader = (tenantId: string, clientId: string) => new PortalReader(tenantClient(tenantId), tenantId, clientId);

/** Document deps for one client of one office: the repo is limited to that client, the store to that office's folder. */
export function portalDocDeps(tenantId: string, clientId: string): PortalDocDeps {
  const db = tenantClient(tenantId);
  return {
    tenantId, repo: new SupabasePortalDocsRepo(db, clientId), store: new SupabaseDocumentStore(db),
    told: async (doc) => {
      const { data } = await db.from("clients").select("id, full_name, owner_id").eq("id", clientId).maybeSingle();
      if (data) await notify(tenantId, portalUploadNotice(data as { id: string; full_name: string; owner_id: string | null }, doc));
    },
  };
}

export const portalStaffRepo = (tenantId: string) => new SupabasePortalStaffRepo(tenantClient(tenantId));

type MemberRow = PortalMember;

/** Every office whose portal this sign-in may open. */
export async function portalMembershipsForUser(userId: string): Promise<MemberRow[]> {
  const { data } = await platformClient("portal_member").from("portal_members").select("*").eq("user_id", userId).eq("status", "active").order("created_at");
  return (data as MemberRow[] | null) ?? [];
}
export async function portalMemberForInviteHash(hash: string): Promise<MemberRow | null> {
  const { data } = await platformClient("portal_invite").from("portal_members").select("*").eq("invite_token_hash", hash).maybeSingle();
  return (data as MemberRow | null) ?? null;
}

export type PortalOffice = { tenantId: string; clientId: string; name: string };
export type PortalContext = {
  userId: string; email: string; tenantId: string; clientId: string; member: PortalMember; office: PortalOffice; offices: PortalOffice[];
  reader: PortalReader;
};

/** Who is using the portal. Not signed in → sign-in; not a client of any office → an explanation. */
export async function requirePortal(): Promise<PortalContext> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/portal");
  // Two-step sign-in is the client's choice; it is enforced only for a client who turned it on.
  if (practiceMfaGate(await mfaState()) === "verify") redirect("/portal/mfa");
  const members = await portalMembershipsForUser(user.id);
  if (!members.length) redirect("/login?error=" + encodeURIComponent("This account doesn't have access to a client portal."));
  const offices: PortalOffice[] = await Promise.all(members.map(async (m) => ({ tenantId: m.tenant_id, clientId: m.client_id, name: (await loadBrand(m.tenant_id)).name })));
  const wanted = (await cookies()).get(PORTAL_COOKIE)?.value;
  const office = offices.find((o) => o.tenantId === wanted) ?? offices[0];
  const member = members.find((m) => m.tenant_id === office.tenantId)!;
  if (!member.last_seen_at || Date.now() - Date.parse(member.last_seen_at) > 3_600_000) {
    await portalMemberRepo(office.tenantId).update(member.id, { last_seen_at: new Date().toISOString() }).catch(() => undefined);
  }
  return { userId: user.id, email: user.email ?? "", tenantId: office.tenantId, clientId: office.clientId, member, office, offices, reader: portalReader(office.tenantId, office.clientId) };
}

export const isOfficeChoice = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** A full address inside the portal, on the deployment's public origin. */
export async function portalLink(path: string) {
  return `${(await appOrigin()).replace(/\/$/, "")}/portal${path}`;
}
export const portalInviteLink = (token: string) => portalLink(`/invite/${token}`);
export { mfaState, sendOfficeEmail as sendPortalEmail };
