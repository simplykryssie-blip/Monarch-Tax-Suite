// Which handler a verified event from a connected Stripe account goes to. One Connect webhook receives every event of every
// connected account, for two different uses of the same connection: a client paying an invoice, and a sale in the store.
// Pure (the handlers are passed in), so the routing can be tested; the wiring is in app/api/stripe/connect-webhook.

export type RoutableEvent = { id: string; type: string; livemode: boolean; account?: string; data: { object: { metadata?: Record<string, string> | null } } };

export type EventRoute = "connection" | "invoice" | "store" | "ignore";

/** Event types the store's fulfilment handles (the same ones its own webhook handles). */
export const STORE_EVENT_TYPES = [
  "checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed",
  "payment_intent.succeeded", "payment_intent.payment_failed", "payment_intent.canceled", "charge.refunded", "charge.dispute.created",
] as const;

/**
 * Account changes belong to the connection. Anything carrying an invoice payment's mark (put on the session, its payment
 * intent and so its charge) is an invoice event. The rest of the store's event types are store events; everything else is ignored.
 * A dispute has no metadata of its own: it goes to the store, which finds no order for an invoice payment and ignores it.
 */
export function routeConnectedEvent(event: RoutableEvent): EventRoute {
  if (event.type === "account.updated" || event.type === "account.application.deauthorized") return "connection";
  if (event.data?.object?.metadata?.invoice_payment_id) return "invoice";
  return (STORE_EVENT_TYPES as readonly string[]).includes(event.type) ? "store" : "ignore";
}

export type DispatchOutcome = { status: "processed" | "ignored" | "duplicate"; route: EventRoute | "unknown_account"; invoiceId?: string; paid?: boolean; tenantId?: string };

export type DispatchDeps<E extends RoutableEvent> = {
  /** The workspace a connected account belongs to, or null. */
  tenantForAccount(account: string): Promise<string | null>;
  /** Connection events and invoice events: the office's own Connect handler. */
  invoiceOrConnection(tenantId: string, event: E): Promise<{ status: "processed" | "ignored" | "duplicate"; invoiceId?: string; paid?: boolean }>;
  /** Store events: null when the workspace's store is not running on this connected account. */
  store(tenantId: string, event: E): Promise<{ status: "processed" | "ignored" | "duplicate" } | null>;
};

export async function dispatchConnectEvent<E extends RoutableEvent>(deps: DispatchDeps<E>, event: E): Promise<DispatchOutcome> {
  if (!event.account) return { status: "ignored", route: "unknown_account" };
  const tenantId = await deps.tenantForAccount(event.account);
  // An account that is not one of ours (the platform's other connected accounts) is acknowledged and left alone.
  if (!tenantId) return { status: "ignored", route: "unknown_account" };
  const route = routeConnectedEvent(event);
  if (route === "ignore") return { status: "ignored", route, tenantId };
  if (route === "store") {
    const outcome = await deps.store(tenantId, event);
    return { status: outcome?.status ?? "ignored", route, tenantId };
  }
  const outcome = await deps.invoiceOrConnection(tenantId, event);
  return { ...outcome, route, tenantId };
}
