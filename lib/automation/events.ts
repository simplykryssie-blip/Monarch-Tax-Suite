// The events Monarch emits and the workflows that can listen to them.

export type EventDef = {
  label: string;
  description: string;
  /** Fields a workflow condition may test (values are small, non-personal strings). */
  fields: Record<string, string[]>;
};

export const EVENTS: Record<string, EventDef> = {
  "license.manual_created": {
    label: "Manual license created",
    description: "An administrator created an internal ($0) license, or reconciled a payment, and the records were saved.",
    fields: { origin: ["internal", "reconciled"] },
  },
  "license.paid_created": {
    label: "Paid license created",
    description: "A signature-verified Stripe payment was recorded and its license was created.",
    fields: { origin: ["stripe"] },
  },
  "license.activated": {
    label: "License key issued",
    description: "An administrator issued the license key, so the license can now be used.",
    fields: {},
  },
  "onboarding.started": {
    label: "Customer opened the setup link",
    description: "The customer opened their secure setup link for the first time. Opening the link is not completed setup.",
    fields: {},
  },
  "crm.connected": {
    label: "CRM connected",
    description: "A CRM connection was verified and saved (after a completed GoHighLevel approval or a saved workflow link).",
    fields: { provider: ["highlevel", "webhook"] },
  },
  "installation.recorded": {
    label: "Installation details recorded",
    description: "The customer submitted their platform and website details for the calculator installation.",
    fields: {},
  },
  "installation.verified": {
    label: "Installation verified",
    description: "An administrator marked the installation active after confirming it.",
    fields: {},
  },
  "lead.delivered": {
    label: "Lead delivered",
    description: "A calculator lead reached the customer's CRM. No lead contents are recorded.",
    fields: { provider: ["highlevel", "webhook"] },
  },
  "lead.delivery_failed": {
    label: "Lead delivery failed",
    description: "A calculator lead could not be delivered to the customer's CRM. No lead contents are recorded.",
    fields: { provider: ["highlevel", "webhook"], error_kind: ["auth", "transient", "permanent"] },
  },
  "license.suspended": {
    label: "License suspended",
    description: "An administrator suspended a license.",
    fields: {},
  },
  "license.revoked": {
    label: "License revoked",
    description: "An administrator revoked a license.",
    fields: {},
  },
};

export const EVENT_TYPES = Object.keys(EVENTS);
export const isEventType = (v: string) => Object.prototype.hasOwnProperty.call(EVENTS, v);
