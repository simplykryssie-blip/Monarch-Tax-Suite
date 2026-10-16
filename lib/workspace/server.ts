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
import { smsConfig, TwilioSmsSender } from "../automation/twilio.ts";
import type { SendDeps } from "./send.ts";

/** Sending from a client's profile: email from the account's default verified sender, texts through Twilio. */
export function sendDeps(tenantId: string = currentTenantId()): SendDeps {
  const a = automationDeps(tenantId);
  return {
    repo: new SupabaseWorkspaceRepo(tenantClient(tenantId)),
    email: a.email,
    sms: new TwilioSmsSender(smsConfig(process.env)),
    sender: () => resolveSender(a.senders ?? null, null, a.fallbackSender ?? null),
    env: a.config.env,
    testRecipients: a.config.testRecipients,
  };
}
