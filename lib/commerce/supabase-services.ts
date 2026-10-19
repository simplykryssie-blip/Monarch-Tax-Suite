import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUniqueViolation, unwrap } from "./supabase-repo.ts";
import type { NewServiceOrder, ServiceOrder, ServiceOrderEvent, ServiceOrdersRepo } from "./service-orders.ts";

/** service_orders and service_order_events; service-role client only (server-side). */
export class SupabaseServiceOrdersRepo implements ServiceOrdersRepo {
  constructor(private db: SupabaseClient) {}
  async createServiceOrder(input: NewServiceOrder) {
    const { data, error } = await this.db.from("service_orders").insert(input).select("*").single();
    if (!error) return { serviceOrder: data as ServiceOrder, created: true };
    if (!isUniqueViolation(error)) unwrap({ data: null, error });
    const existing = await this.findServiceOrderByOrder(input.order_id);
    if (!existing) throw new Error("Service order exists but could not be read.");
    return { serviceOrder: existing, created: false };
  }
  async getServiceOrder(id: string) {
    return unwrap(await this.db.from("service_orders").select("*").eq("id", id).maybeSingle()) as ServiceOrder | null;
  }
  async findServiceOrderByOrder(orderId: string) {
    return unwrap(await this.db.from("service_orders").select("*").eq("order_id", orderId).maybeSingle()) as ServiceOrder | null;
  }
  async updateServiceOrder(id: string, patch: Partial<ServiceOrder>) {
    return unwrap(await this.db.from("service_orders").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("*").single()) as ServiceOrder;
  }
  async listServiceOrders(tenantId: string) {
    return unwrap(await this.db.from("service_orders").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false })) as ServiceOrder[];
  }
  async addServiceOrderEvent(input: Omit<ServiceOrderEvent, "id" | "created_at">) {
    unwrap(await this.db.from("service_order_events").insert(input));
  }
  async listServiceOrderEvents(serviceOrderId: string) {
    return unwrap(await this.db.from("service_order_events").select("*").eq("service_order_id", serviceOrderId).order("created_at", { ascending: true })) as ServiceOrderEvent[];
  }
}
