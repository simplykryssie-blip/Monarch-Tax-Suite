import { ValidationError } from "../commerce/validation.ts";
import { ASK_FIELD, askLabel } from "../documents/fields.ts";
import { createDelivery, sendableVersion, type DocumentDeps } from "../documents/service.ts";
import { clientDocumentValues } from "../documents/values.ts";
import { ssnForDocument, type SsnDeps } from "../ssn/service.ts";

// Sending a library document to a client, to read or to sign, in the portal (Form 8879, Form 8821, an engagement
// letter). The document is filled from the client's record and the office's profile; whatever can't come from records
// (the matters an 8821 covers) is typed by staff at send time; the full SSN, when the form has a field for it, is
// decrypted on the server and written only into the filled copy.

export type SigningClient = { id: string; full_name: string; email: string | null; phone: string | null; address: string | null; ssn_last4: string | null; archived_at: string | null };
export type SigningDeps = { docs: DocumentDeps; ssn: SsnDeps | null; now?: () => Date };

/** The fields staff must fill in at send time for this document, in the order the form uses them. */
export async function askFieldsFor(docs: DocumentDeps, documentId: string, kind: "send" | "signature" = "signature"): Promise<{ name: string; label: string }[]> {
  const { version } = await sendableVersion(docs, documentId, kind);
  return version.merge_fields.filter((f) => ASK_FIELD.test(f)).map((name) => ({ name, label: askLabel(name) }));
}

const cleanAsk = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) : "");

export async function sendToClient(
  deps: SigningDeps,
  input: { documentId: string; kind: "send" | "signature"; client: SigningClient; asks: Record<string, unknown>; linkDays?: number; reminderDays?: number | null; actorId: string | null },
) {
  const { client } = input;
  if (client.archived_at) throw new ValidationError("This client is archived.");
  if (!client.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(client.email)) throw new ValidationError("Add the client's email address first. The signing link is sent there.");
  const { version } = await sendableVersion(deps.docs, input.documentId, input.kind);
  const profile = await deps.docs.repo.getProfile();
  const values = clientDocumentValues({ profile, client, now: deps.now ? deps.now() : new Date() });
  const missingAsks: string[] = [];
  for (const f of version.merge_fields.filter((x) => ASK_FIELD.test(x))) {
    const v = cleanAsk(input.asks[f]);
    if (!v) missingAsks.push(askLabel(f));
    else values[f] = v;
  }
  if (missingAsks.length) throw new ValidationError(`Fill in: ${missingAsks.join("; ")}.`);
  if (version.merge_fields.includes("client_ssn")) {
    if (!deps.ssn) throw new ValidationError("Encrypted storage isn't set up on this deployment yet.");
    const doc = await deps.docs.repo.getDocument(input.documentId);
    values.client_ssn = await ssnForDocument(deps.ssn, { clientId: client.id, actorId: input.actorId, documentName: doc?.name ?? "document" });
  }
  const made = await createDelivery(deps.docs, {
    documentId: input.documentId, kind: input.kind, recipientEmail: client.email, recipientName: client.full_name, customerId: null, orderId: null, clientId: client.id,
    executionId: null, actionIndex: null, isTest: false, values, linkDays: input.linkDays ?? 30, reminderDays: input.kind === "signature" ? input.reminderDays ?? 7 : null, createdBy: input.actorId,
  });
  return { ...made, firstName: values.client_first_name, firmName: values.firm_name || "Your tax office" };
}
