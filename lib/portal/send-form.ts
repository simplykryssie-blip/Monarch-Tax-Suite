import { ValidationError } from "../commerce/validation.ts";
import { senderFor, type AutomationDeps } from "../automation/engine.ts";
import { layout, oneLine } from "../documents/emails.ts";
import { createInvite, type InviteClient } from "../forms/invites.ts";
import type { FormDeps } from "../forms/service.ts";
import type { FormRow } from "../forms/types.ts";

/**
 * Sends a published form to a client: their personal link, by email. Returns the sentence to show the person who sent it.
 * `linkFor` makes the form's public address for this office (it needs the request), and the personal part is added here.
 */
export async function sendFormToClient(
  auto: AutomationDeps,
  forms: FormDeps,
  input: { formId: string; client: InviteClient; message: string; actorId: string | null; linkFor: (form: FormRow) => Promise<string | null> },
): Promise<string> {
  const { invite, token, form } = await createInvite(forms, { formId: input.formId, client: input.client, createdBy: input.actorId });
  const base = await input.linkFor(form);
  if (!base) {
    await forms.repo.updateInvite(invite.id, { revoked_at: new Date().toISOString() });
    throw new ValidationError("Set up your web address first (Settings → Websites), so the link can be made.");
  }
  const to = input.client.email!;
  if (auto.config.env !== "production" && !auto.config.testRecipients.map((r) => r.toLowerCase()).includes(to.toLowerCase())) {
    throw new ValidationError(`The form was saved to send, but this is a ${auto.config.env} environment: emails go only to the addresses in AUTOMATION_TEST_RECIPIENTS.`);
  }
  const profile = await forms.profile();
  const firm = profile?.display_name ?? "Your tax office";
  const url = `${base}${base.includes("?") ? "&" : "?"}i=${token}`;
  const first = input.client.full_name.trim().split(/\s+/)[0];
  const body = layout(
    firm,
    [first ? `Hello ${first},` : "Hello,", `${firm} has sent you a form to fill in: "${form.name}".`, ...(input.message.trim() ? [input.message.slice(0, 1000)] : []), `This link is personal to you and works until ${new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(invite.expires_at))}.`],
    { label: "Open the form", url },
    "If you were not expecting this, you can ignore this email.",
  );
  const result = await auto.email.send({ ...(await senderFor(auto, null)), to, subject: oneLine(`${firm} sent you a form: ${form.name}`), html: body.html, text: body.text, idempotencyKey: `client-form:${invite.id}` });
  if (!result.ok) throw new ValidationError(`The form was saved, but the email was not sent: ${result.message}`);
  return `"${form.name}" was sent to ${to}.`;
}
