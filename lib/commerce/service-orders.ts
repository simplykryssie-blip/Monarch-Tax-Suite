import { ValidationError, SERVICE_SETTINGS } from "./validation.ts";
import type { Order, Product } from "./types.ts";

// Service orders (decision E2: manual, trackable fulfillment, no scheduling). A paid order for a service product
// creates exactly one service order. It snapshots what the buyer was promised (deliverable, owner, response time;
// decision E4), so later product edits never rewrite it, and records every status change and note.

export const SERVICE_STATUSES = ["new", "in_progress", "waiting_on_customer", "delivered", "canceled"] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  new: "New",
  in_progress: "In progress",
  waiting_on_customer: "Waiting on customer",
  delivered: "Delivered",
  canceled: "Canceled",
};

export type ServiceOrder = {
  id: string;
  tenant_id: string;
  order_id: string;
  product_id: string;
  customer_id: string;
  status: ServiceStatus;
  deliverable: string;
  owner: string;
  response_time: string;
  next_step: string | null;
  delivered_at: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
};
export type NewServiceOrder = Omit<ServiceOrder, "id" | "status" | "delivered_at" | "canceled_at" | "created_at" | "updated_at">;
export type ServiceOrderEvent = { id: string; tenant_id: string; service_order_id: string; from_status: ServiceStatus | null; to_status: ServiceStatus | null; note: string | null; actor_id: string | null; created_at: string };

export interface ServiceOrdersRepo {
  /** Inserts unless one exists for the order; returns the existing one then. */
  createServiceOrder(input: NewServiceOrder): Promise<{ serviceOrder: ServiceOrder; created: boolean }>;
  getServiceOrder(id: string): Promise<ServiceOrder | null>;
  findServiceOrderByOrder(orderId: string): Promise<ServiceOrder | null>;
  updateServiceOrder(id: string, patch: Partial<Pick<ServiceOrder, "status" | "next_step" | "delivered_at" | "canceled_at">>): Promise<ServiceOrder>;
  listServiceOrders(tenantId: string): Promise<ServiceOrder[]>;
  addServiceOrderEvent(input: Omit<ServiceOrderEvent, "id" | "created_at">): Promise<void>;
  listServiceOrderEvents(serviceOrderId: string): Promise<ServiceOrderEvent[]>;
}

const FIRST_STEP = "Contact the customer to confirm the details and start the work.";

/** Creates the service order for a paid order of a service product. Idempotent per order. */
export async function ensureServiceOrder(repo: ServiceOrdersRepo, tenantId: string, order: Order, product: Product) {
  if (product.product_type !== "service") return null;
  if (order.payment_status !== "paid") throw new ValidationError("Only paid orders become service orders.");
  const setting = (key: keyof typeof SERVICE_SETTINGS) => product.metadata[key]?.trim().slice(0, key === "service_deliverable" ? 500 : 120) || "Not defined: confirm with the customer";
  const result = await repo.createServiceOrder({
    tenant_id: tenantId,
    order_id: order.id,
    product_id: product.id,
    customer_id: order.customer_id,
    deliverable: setting("service_deliverable"),
    owner: setting("service_owner"),
    response_time: setting("service_response_time"),
    next_step: FIRST_STEP,
  });
  if (result.created) await repo.addServiceOrderEvent({ tenant_id: tenantId, service_order_id: result.serviceOrder.id, from_status: null, to_status: "new", note: "Created from the paid order.", actor_id: null });
  return result;
}

const TRANSITIONS: Record<ServiceStatus, ServiceStatus[]> = {
  new: ["in_progress", "waiting_on_customer", "delivered", "canceled"],
  in_progress: ["waiting_on_customer", "delivered", "canceled"],
  waiting_on_customer: ["in_progress", "delivered", "canceled"],
  // A delivered service can be reopened for a correction; a canceled one is final.
  delivered: ["in_progress"],
  canceled: [],
};

/** An administrator's update: a status change, the next step, and/or a note. Every change is recorded. */
export async function updateServiceOrder(
  repo: ServiceOrdersRepo,
  id: string,
  input: { status?: ServiceStatus; nextStep?: string | null; note?: string | null },
  actorId: string,
  now = new Date(),
): Promise<{ serviceOrder: ServiceOrder; delivered: boolean }> {
  const current = await repo.getServiceOrder(id);
  if (!current) throw new ValidationError("Service order not found.");
  const status = input.status && input.status !== current.status ? input.status : null;
  if (status && !TRANSITIONS[current.status].includes(status)) throw new ValidationError(`A ${SERVICE_STATUS_LABELS[current.status].toLowerCase()} service order cannot become ${SERVICE_STATUS_LABELS[status].toLowerCase()}.`);
  const nextStep = input.nextStep === undefined ? undefined : input.nextStep?.trim().slice(0, 500) || null;
  const note = input.note?.trim().slice(0, 2000) || null;
  if (status === "waiting_on_customer" && !(nextStep !== undefined ? nextStep : current.next_step)) throw new ValidationError("Say what the customer needs to do in Next step.");
  if (!status && nextStep === undefined && !note) throw new ValidationError("Nothing to update.");
  const patch: Partial<ServiceOrder> = {};
  if (status) patch.status = status;
  if (status === "delivered") Object.assign(patch, { delivered_at: now.toISOString(), next_step: null });
  if (status === "canceled") Object.assign(patch, { canceled_at: now.toISOString(), next_step: null });
  if (status === "in_progress" && current.status === "delivered") patch.delivered_at = null;
  if (nextStep !== undefined && status !== "delivered" && status !== "canceled") patch.next_step = nextStep;
  const serviceOrder = Object.keys(patch).length ? await repo.updateServiceOrder(id, patch) : current;
  await repo.addServiceOrderEvent({ tenant_id: current.tenant_id, service_order_id: id, from_status: status ? current.status : null, to_status: status, note: note ?? (nextStep !== undefined && !status ? `Next step: ${nextStep ?? "cleared"}` : null), actor_id: actorId });
  return { serviceOrder, delivered: status === "delivered" };
}

/** A full refund or a dispute of the order cancels its open service order. */
export async function cancelServiceForOrder(repo: ServiceOrdersRepo, orderId: string, reason: string, now = new Date()) {
  const so = await repo.findServiceOrderByOrder(orderId);
  if (!so || so.status === "canceled" || so.status === "delivered") return null;
  const updated = await repo.updateServiceOrder(so.id, { status: "canceled", canceled_at: now.toISOString(), next_step: null });
  await repo.addServiceOrderEvent({ tenant_id: so.tenant_id, service_order_id: so.id, from_status: so.status, to_status: "canceled", note: reason, actor_id: null });
  return updated;
}

/** Who the service order waits on and what moves it forward. */
export function serviceNextStep(so: Pick<ServiceOrder, "status" | "next_step" | "owner">): { waitingOn: "nobody" | "owner" | "customer"; text: string } {
  if (so.status === "delivered") return { waitingOn: "nobody", text: "Delivered." };
  if (so.status === "canceled") return { waitingOn: "nobody", text: "Canceled." };
  if (so.status === "waiting_on_customer") return { waitingOn: "customer", text: so.next_step ?? "Waiting on the customer." };
  return { waitingOn: "owner", text: `${so.owner}: ${so.next_step ?? "Do the work, then mark it Delivered."}` };
}
