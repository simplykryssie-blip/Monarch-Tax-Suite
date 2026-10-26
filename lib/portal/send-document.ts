import { ValidationError } from "../commerce/validation.ts";
import { senderFor, type AutomationDeps } from "../automation/engine.ts";
import { documentEmail } from "../documents/emails.ts";
import { deliveryPathFor } from "../documents/service.ts";
import { sendToClient, type SigningClient, type SigningDeps } from "./signing.ts";

/**
 * Sends a library document to a client and emails them the secure link: to read and download, or to sign.
 * Returns the sentence to show the person who sent it.
 */
export async function sendDocumentToClient(
  auto: AutomationDeps,
  signing: SigningDeps,
  input: { documentId: string; kind: "send" | "signature"; client: SigningClient; asks: Record<string, unknown>; message: string; actorId: string | null },
): Promise<string> {
  const made = await sendToClient(signing, { documentId: input.documentId, kind: input.kind, client: input.client, asks: input.asks, actorId: input.actorId });
  const to = input.client.email!;
  if (auto.config.env !== "production" && !auto.config.testRecipients.map((r) => r.toLowerCase()).includes(to.toLowerCase())) {
    throw new ValidationError(`The copy was saved, but this is a ${auto.config.env} environment: emails go only to the addresses in AUTOMATION_TEST_RECIPIENTS.`);
  }
  const origin = (await auto.config.origin()).replace(/\/$/, "");
  const mail = documentEmail({ kind: input.kind, firmName: made.firmName, documentName: made.document.name, clientFirstName: made.firstName || null, message: input.message.slice(0, 1000), url: `${origin}${deliveryPathFor(input.kind, made.token)}`, expiresAt: new Date(made.delivery.expires_at) });
  const result = await auto.email.send({ ...(await senderFor(auto, null)), to, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: `client-doc:${made.delivery.id}` });
  if (!result.ok) throw new ValidationError(`The copy was saved, but the email was not sent: ${result.message}`);
  return input.kind === "signature" ? `"${made.document.name}" was sent to ${to} to sign.` : `"${made.document.name}" was sent to ${to}.`;
}
