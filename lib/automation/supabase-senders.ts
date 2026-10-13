import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import type { EmailDomainRow, PackageAttribute, SenderRow, SendersRepo } from "./senders.ts";

/** Sending domains, senders and package attributes, on a tenant-scoped client (row-level security per tenant). */
export class SupabaseSendersRepo implements SendersRepo {
  private db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }
  async listDomains() { return unwrap(await this.db.from("email_domains").select("*").order("domain")) as EmailDomainRow[]; }
  async getDomain(id: string) { return unwrap(await this.db.from("email_domains").select("*").eq("id", id).maybeSingle()) as EmailDomainRow | null; }
  async insertDomain(input: Pick<EmailDomainRow, "domain" | "provider_domain_id" | "status" | "dns_records" | "created_by">) {
    return unwrap(await this.db.from("email_domains").insert(input).select("*").single()) as EmailDomainRow;
  }
  async updateDomain(id: string, patch: Partial<EmailDomainRow>) {
    return unwrap(await this.db.from("email_domains").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("*").single()) as EmailDomainRow;
  }
  async listSenders() { return unwrap(await this.db.from("email_senders").select("*").order("created_at")) as SenderRow[]; }
  async getSender(id: string) { return unwrap(await this.db.from("email_senders").select("*").eq("id", id).maybeSingle()) as SenderRow | null; }
  async insertSender(input: Pick<SenderRow, "domain_id" | "from_name" | "local_part" | "reply_to" | "created_by">) {
    return unwrap(await this.db.from("email_senders").insert(input).select("*").single()) as SenderRow;
  }
  async updateSender(id: string, patch: Partial<SenderRow>) {
    return unwrap(await this.db.from("email_senders").update(patch).eq("id", id).select("*").single()) as SenderRow;
  }
  async setDefaultSender(id: string) {
    unwrap(await this.db.from("email_senders").update({ is_default: false }).eq("is_default", true).neq("id", id));
    unwrap(await this.db.from("email_senders").update({ is_default: true }).eq("id", id));
  }
  async listPackageAttributes() { return unwrap(await this.db.from("package_attributes").select("*").order("key")) as PackageAttribute[]; }
  async insertPackageAttribute(input: Pick<PackageAttribute, "key" | "label" | "kind" | "options">) {
    return unwrap(await this.db.from("package_attributes").insert(input).select("*").single()) as PackageAttribute;
  }
  async updatePackageAttribute(id: string, patch: Partial<PackageAttribute>) {
    return unwrap(await this.db.from("package_attributes").update(patch).eq("id", id).select("*").single()) as PackageAttribute;
  }
  async deletePackageAttribute(id: string) { unwrap(await this.db.from("package_attributes").delete().eq("id", id)); }
}
