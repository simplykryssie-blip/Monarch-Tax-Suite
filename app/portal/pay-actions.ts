"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { sanitizeError } from "@/lib/automation/sanitize.ts";
import { ValidationError } from "@/lib/commerce/validation.ts";
import { startInvoiceCheckout } from "@/lib/connect/service.ts";
import { connectDeps } from "@/lib/connect/server";
import { portalLink, requirePortal } from "@/lib/portal/server";

// A client pays one of their own invoices online. The payment page is Stripe's, on the office's connected account.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function payInvoiceAction(form: FormData) {
  const ctx = await requirePortal();
  let target: string;
  try {
    const id = String(form.get("invoice_id") ?? "");
    if (!UUID.test(id)) throw new ValidationError("That invoice wasn't found.");
    const deps = connectDeps(ctx.tenantId);
    if (!deps) throw new ValidationError("Online payment isn't available right now. Please pay your tax office another way.");
    const client = await ctx.reader.client();
    const session = await startInvoiceCheckout(deps, {
      invoiceId: id, clientId: ctx.clientId, clientEmail: client?.email ?? null, office: ctx.office.name, actorId: ctx.userId,
      successUrl: await portalLink("/invoices?paid=1"), cancelUrl: await portalLink("/invoices?cancelled=1"),
    });
    target = session.url;
  } catch (e) {
    unstable_rethrow(e);
    const message = e instanceof ValidationError ? e.message : (console.error(`portal pay failed: ${sanitizeError(e, 200)}`), "The payment page couldn't be opened. Nothing was charged. Please try again.");
    target = `/portal/invoices?error=${encodeURIComponent(message)}`;
  }
  redirect(target);
}
