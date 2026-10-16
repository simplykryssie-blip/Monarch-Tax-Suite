import "server-only";
import { tenantClient } from "../supabase/service";
import { currentTenantId } from "../tenants.ts";
import { SupabaseWorkspaceRepo } from "./supabase-repo.ts";

export const workspaceRepo = (tenantId: string = currentTenantId()) => new SupabaseWorkspaceRepo(tenantClient(tenantId));

import { SupabaseDocumentStore } from "../documents/supabase-repo.ts";
import type { DocDeps } from "./docs.ts";

export function docDeps(tenantId: string = currentTenantId()): DocDeps {
  const db = tenantClient(tenantId);
  return { tenantId, repo: new SupabaseWorkspaceRepo(db), store: new SupabaseDocumentStore(db) };
}

import { automationDeps } from "../automation/server";
import { resolveSender } from "../automation/senders.ts";
import { tenantSms } from "../sms/server";
import type { SendDeps } from "./send.ts";

/** Sending from a client's profile: email from the account's default verified sender, texts from its own Twilio account. */
export async function sendDeps(tenantId: string = currentTenantId()): Promise<SendDeps> {
  const a = automationDeps(tenantId);
  const sms = await tenantSms(tenantId);
  return {
    repo: new SupabaseWorkspaceRepo(tenantClient(tenantId)),
    email: a.email,
    sms: {
      sender: sms.sender,
      problem: sms.route.ok ? null : sms.route.problem,
      credits: sms.route.billing === "credits"
        ? {
          spend: (n, ref) => sms.repo.spend(n, ref),
          refund: (n, ref) => sms.repo.credit({ delta: n, kind: "refund", reference: ref, note: "Text not sent", created_by: null }),
          balance: () => sms.repo.balance(),
        }
        : null,
    },
    sender: () => resolveSender(a.senders ?? null, null, a.fallbackSender ?? null),
    env: a.config.env,
    testRecipients: a.config.testRecipients,
  };
}
