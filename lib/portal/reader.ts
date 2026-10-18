import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "../commerce/supabase-repo.ts";
import type { ClientMessage, ClientReturn } from "../workspace/types.ts";
import { portalMessageVisible } from "./visibility.ts";

// What the portal may read, for ONE client of ONE office. The database client is already limited to the office (row-level
// security); every query here also names the client, so a page built from this reader has no way to ask for another
// client's rows. It only selects the columns a client may see: no notes, tasks, internal flags or staff identities.

export type PortalClient = { id: string; full_name: string; email: string | null; phone: string | null; ssn_last4: string | null; address: string | null };
export type PortalReturn = Pick<ClientReturn, "id" | "tax_year" | "kind" | "stage_id" | "due_on" | "filed_on">;
export type PortalMessage = Pick<ClientMessage, "id" | "direction" | "channel" | "subject" | "body" | "occurred_at">;

export class PortalReader {
  private db: SupabaseClient;
  readonly tenantId: string;
  readonly clientId: string;
  constructor(db: SupabaseClient, tenantId: string, clientId: string) {
    this.db = db;
    this.tenantId = tenantId;
    this.clientId = clientId;
  }

  /** Last four digits only: the full number is never read for the portal. */
  async client() {
    return unwrap(await this.db.from("clients").select("id, full_name, email, phone, ssn_last4, address").eq("id", this.clientId).is("archived_at", null).maybeSingle()) as PortalClient | null;
  }
  async returns() {
    return unwrap(await this.db.from("client_returns").select("id, tax_year, kind, stage_id, due_on, filed_on").eq("client_id", this.clientId).is("archived_at", null).order("tax_year", { ascending: false }).limit(50)) as PortalReturn[];
  }
  async messages() {
    const rows = unwrap(await this.db.from("client_messages").select("id, direction, channel, subject, body, occurred_at, status").eq("client_id", this.clientId).order("occurred_at", { ascending: false }).limit(100)) as (PortalMessage & { status: ClientMessage["status"] })[];
    return rows.filter(portalMessageVisible).map((m) => ({ id: m.id, direction: m.direction, channel: m.channel, subject: m.subject, body: m.body, occurred_at: m.occurred_at }));
  }
}
