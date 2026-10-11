"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, serviceOrdersRepo } from "@/lib/admin";
import { safeEmit } from "@/lib/automation/server";
import { SERVICE_STATUSES, updateServiceOrder, type ServiceStatus } from "@/lib/commerce/service-orders.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const str = (form: FormData, k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");

/** Status, next step and note for one service order. Delivering it sends the customer the completion notice. */
export async function updateServiceOrderAction(form: FormData) {
  const admin = await requireAdmin();
  const id = str(form, "id");
  if (!UUID.test(id)) redirect("/service-orders");
  const back = `/service-orders/${id}`;
  let target: string;
  try {
    const raw = str(form, "status");
    const status = (SERVICE_STATUSES as readonly string[]).includes(raw) ? (raw as ServiceStatus) : undefined;
    const { serviceOrder, delivered } = await updateServiceOrder(serviceOrdersRepo(), id, { status, nextStep: form.has("next_step") ? str(form, "next_step") : undefined, note: str(form, "note") }, admin.userId);
    if (delivered) await safeEmit({ type: "service.order_delivered", key: `service:${serviceOrder.id}:delivered:${serviceOrder.delivered_at}`, customerId: serviceOrder.customer_id, orderId: serviceOrder.order_id, data: {} });
    target = `${back}?notice=${encodeURIComponent(delivered ? "Marked delivered. The customer is sent the completion notice." : "Service order updated.")}`;
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    target = `${back}?error=${encodeURIComponent(e.message)}`;
  }
  revalidatePath("/service-orders");
  redirect(target);
}
