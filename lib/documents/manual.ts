import { ValidationError } from "../commerce/validation.ts";
import { emitEvent, senderFor, type AutomationDeps } from "../automation/engine.ts";
import { isEmailAddress } from "../automation/email.ts";
import { sanitizeError } from "../automation/sanitize.ts";
import { createDelivery, deliveryPathFor, type DocumentDeps } from "./service.ts";
import { documentEmail } from "./emails.ts";
import { documentValues } from "./values.ts";

// "Send to a customer…" from a document's page: the same copy, link and email a workflow step produces, by hand.

export async function sendDocumentManually(
  auto: AutomationDeps,
  docs: DocumentDeps,
  input: { documentId: string; customerId: string; orderId: string | null; kind: "send" | "signature"; senderId: string | null; message: string; linkDays: number; reminderDays: number | null; actorId: string },
): Promise<{ deliveryId: string }> {
  const customer = await auto.commerce.getCustomer(input.customerId);
  if (!customer || !isEmailAddress(customer.email)) throw new ValidationError("Choose a customer with a valid email address.");
  if (auto.config.env !== "production" && !auto.config.testRecipients.map((r) => r.toLowerCase()).includes(customer.email.toLowerCase())) {
    throw new ValidationError(`This is a ${auto.config.env} environment: documents go only to the addresses in AUTOMATION_TEST_RECIPIENTS.`);
  }
  const order = input.orderId ? await auto.commerce.getOrder(input.orderId) : null;
  if (order && order.customer_id !== customer.id) throw new ValidationError("That order belongs to someone else.");
  const product = order ? await auto.commerce.getProduct(order.product_id) : null;
  const profile = await docs.repo.getProfile();
  const values = documentValues({ profile, customer, order, product, now: auto.now ? auto.now() : new Date() });
  const sender = await senderFor(auto, input.senderId);
  const made = await createDelivery(docs, {
    documentId: input.documentId, kind: input.kind, recipientEmail: customer.email, recipientName: customer.full_name, customerId: customer.id, orderId: order?.id ?? null,
    executionId: null, actionIndex: null, isTest: false, values, linkDays: input.linkDays, reminderDays: input.reminderDays, createdBy: input.actorId,
  });
  const origin = (await auto.config.origin()).replace(/\/$/, "");
  const mail = documentEmail({
    kind: input.kind, firmName: profile?.display_name ?? "Your tax office", documentName: made.document.name, clientFirstName: values.client_first_name || null,
    message: input.message, url: `${origin}${deliveryPathFor(input.kind, made.token)}`, expiresAt: new Date(made.delivery.expires_at),
  });
  const result = await auto.email.send({ ...sender, to: customer.email, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: `manual:${made.delivery.id}` });
  if (!result.ok) throw new ValidationError(`The copy was saved but the email was not sent: ${result.message}`);
  if (input.kind === "send") {
    await emitEvent(auto, { type: "document.sent", key: `delivery:${made.delivery.id}:sent`, customerId: customer.id, orderId: order?.id ?? null, data: { document_id: made.document.id } })
      .catch((e) => console.error(`documents: document.sent not recorded: ${sanitizeError(e, 120)}`));
  }
  return { deliveryId: made.delivery.id };
}
