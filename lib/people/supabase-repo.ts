import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientMatch, PeopleRepo } from "./match.ts";

export class SupabasePeopleRepo implements PeopleRepo {
  constructor(private db: SupabaseClient) {}

  async findCustomers(email: string) {
    const { data, error } = await this.db.from("calculator_customers").select("id").ilike("email", email.replace(/[\\%_]/g, "\\$&")).limit(5);
    if (error) throw new Error(`customer lookup failed: ${error.message}`);
    return (data ?? []) as { id: string }[];
  }

  async findClients(email: string): Promise<ClientMatch[]> {
    const { data, error } = await this.db.from("clients").select("id, phone").eq("email", email).is("archived_at", null).limit(20);
    if (error) throw new Error(`client lookup failed: ${error.message}`);
    return (data ?? []) as ClientMatch[];
  }

  async fillClientPhone(id: string, phone: string) {
    const { error } = await this.db.from("clients").update({ phone }).eq("id", id).is("phone", null);
    if (error) throw new Error(`client update failed: ${error.message}`);
  }
}
