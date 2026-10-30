import { layout, oneLine, type BuiltEmail } from "../documents/emails.ts";

// Emails about form submissions. The firm's notice contains no answers or files: forms collect IDs and banking documents,
// and email is not a safe place for those. The respondent's confirmation carries a PDF copy of their own answers (sensitive
// numbers masked to the last four, uploaded files left out). Plain, escaped text only.

export function firmSubmissionEmail(input: { firmName: string; formName: string; number: number; submittedAt: string; respondent: string | null; adminUrl: string }): BuiltEmail {
  const body = layout(
    input.firmName,
    [
      `New submission #${input.number} for "${input.formName}".`,
      `Submitted: ${input.submittedAt}`,
      input.respondent ? `From: ${input.respondent}` : "The respondent did not give their name or email.",
      "The answers and files are in the admin. They are not included in this email.",
    ],
    { label: "Open the submission", url: input.adminUrl },
    "Automatic notice from your forms.",
  );
  return { ...body, subject: oneLine(`New submission #${input.number}: ${input.formName}${input.respondent ? ` (${input.respondent})` : ""}`) };
}

export function respondentConfirmationEmail(input: { firmName: string; formName: string; number: number; submittedAt: string; name: string | null; message: string; pdfAttached?: boolean }): BuiltEmail {
  const body = layout(
    input.firmName,
    [
      input.name ? `Hello ${input.name.split(/\s+/)[0]},` : "Hello,",
      `We received your "${input.formName}" submission (#${input.number}) on ${input.submittedAt}.`,
      ...(input.message.trim() ? [input.message] : []),
      input.pdfAttached
        ? "A PDF copy of your answers is attached. Sensitive numbers, like a Social Security number, show only their last four digits, and files you uploaded are not included."
        : "For your security, this email doesn't include your answers or files.",
    ],
    null,
    `Sent by ${input.firmName}. If you did not fill in this form, contact them.`,
  );
  return { ...body, subject: oneLine(`We received your submission: ${input.formName}`) };
}

export function resumeEmail(input: { firmName: string; formName: string; url: string; expiresAt: string }): BuiltEmail {
  const body = layout(
    input.firmName,
    [
      "Hello,",
      `You saved "${input.formName}" to finish later. Use the button below to pick up where you left off.`,
      `The link works until ${input.expiresAt}. Anyone with the link can see what you entered, so don't share it.`,
    ],
    { label: "Continue the form", url: input.url },
    "If you did not save this form, you can ignore this email.",
  );
  return { ...body, subject: oneLine(`Continue your form: ${input.formName}`) };
}
