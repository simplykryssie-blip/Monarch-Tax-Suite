import { emitEvent, type AutomationDeps } from "../automation/engine.ts";
import { resolveSender } from "../automation/senders.ts";
import { sanitizeError } from "../automation/sanitize.ts";
import { deliveryPathFor, linkToken, sweepSignatures, type DocumentDeps } from "./service.ts";
import { documentEmail, firmNoticeEmail, signedConfirmationEmail } from "./emails.ts";
import type { Delivery, LibraryDocument, SignatureRequest } from "./types.ts";

// What follows a signature outcome: emails to the signer and the firm, and the workflow event. Failures here are
// logged and never undo the signature itself.

type Outcome = { request: SignatureRequest; document: LibraryDocument; delivery: Delivery };

async function sender(auto: AutomationDeps) {
  try {
    const s = await resolveSender(auto.senders ?? null, null, auto.fallbackSender ?? null);
    return { from: s.from, replyTo: s.replyTo };
  } catch {
    return {};
  }
}

async function context(auto: AutomationDeps, docs: DocumentDeps) {
  const profile = await docs.repo.getProfile();
  const origin = (await auto.config.origin()).replace(/\/$/, "");
  return { firmName: profile?.display_name ?? "Your tax office", firmEmail: profile?.email ?? auto.config.supportRecipient, origin };
}

async function send(auto: AutomationDeps, to: string, mail: { subject: string; html: string; text: string }, key: string) {
  if (auto.config.env !== "production" && !auto.config.testRecipients.map((r) => r.toLowerCase()).includes(to.toLowerCase())) return;
  const result = await auto.email.send({ ...(await sender(auto)), to, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: key });
  if (!result.ok) console.error(`documents: email ${key} not sent: ${sanitizeError(result.message, 120)}`);
}

async function raise(auto: AutomationDeps, o: Outcome, type: string) {
  if (o.delivery.is_test) return;
  await emitEvent(auto, { type, key: `signature:${o.request.id}:${type}`, customerId: o.delivery.customer_id, orderId: o.delivery.order_id, data: { document_id: o.document.id } })
    .catch((e) => console.error(`documents: ${type} not recorded: ${sanitizeError(e, 120)}`));
}

export async function afterSigned(auto: AutomationDeps, docs: DocumentDeps, o: Outcome) {
  const c = await context(auto, docs);
  const url = `${c.origin}${deliveryPathFor("signature", linkToken(docs.linkKey, o.delivery.id))}`;
  await send(auto, o.request.signer_email, signedConfirmationEmail({ firmName: c.firmName, documentName: o.document.name, signerName: o.request.signed_name ?? "there", url }), `signed:${o.request.id}:signer`);
  await send(auto, c.firmEmail, firmNoticeEmail({ firmName: c.firmName, outcome: "signed", documentName: o.document.name, clientName: o.request.signed_name ?? o.request.signer_name ?? "The client", clientEmail: o.request.signer_email, adminUrl: `${c.origin}/documents/${o.document.id}` }), `signed:${o.request.id}:firm`);
  await raise(auto, o, "document.signed");
}

export async function afterDeclined(auto: AutomationDeps, docs: DocumentDeps, o: Outcome) {
  const c = await context(auto, docs);
  await send(auto, c.firmEmail, firmNoticeEmail({ firmName: c.firmName, outcome: "declined", documentName: o.document.name, clientName: o.request.signer_name ?? "The client", clientEmail: o.request.signer_email, reason: o.request.decline_reason, adminUrl: `${c.origin}/documents/${o.document.id}` }), `declined:${o.request.id}:firm`);
  await raise(auto, o, "document.signature_declined");
}

/** Expires overdue signature requests (notice + event) and sends due reminders. Safe to run often. */
export async function runSignatureSweep(auto: AutomationDeps, docs: DocumentDeps): Promise<{ expired: number; reminded: number }> {
  const { expired, remind } = await sweepSignatures(docs);
  const c = await context(auto, docs);
  for (const request of expired) {
    const delivery = await docs.repo.getDelivery(request.delivery_id);
    const document = await docs.repo.getDocument(request.document_id);
    if (!delivery || !document) continue;
    await send(auto, c.firmEmail, firmNoticeEmail({ firmName: c.firmName, outcome: "expired", documentName: document.name, clientName: request.signer_name ?? "The client", clientEmail: request.signer_email, adminUrl: `${c.origin}/documents/${document.id}` }), `expired:${request.id}:firm`);
    await raise(auto, { request, document, delivery }, "document.signature_expired");
  }
  for (const request of remind) {
    const delivery = await docs.repo.getDelivery(request.delivery_id);
    const document = await docs.repo.getDocument(request.document_id);
    if (!delivery || !document || delivery.revoked_at) continue;
    const mail = documentEmail({
      kind: "signature", reminder: true, firmName: c.firmName, documentName: document.name, clientFirstName: request.signer_name?.split(/\s+/)[0] ?? null, message: "",
      url: `${c.origin}${deliveryPathFor("signature", linkToken(docs.linkKey, delivery.id))}`, expiresAt: new Date(request.expires_at),
    });
    await send(auto, request.signer_email, mail, `reminder:${request.id}:${(request.last_reminded_at ?? "").slice(0, 10)}`);
  }
  return { expired: expired.length, reminded: remind.length };
}
