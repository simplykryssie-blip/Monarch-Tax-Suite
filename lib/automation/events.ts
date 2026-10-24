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
  "service.order_created": {
    label: "Service order created",
    description: "A signature-verified payment for a service product created its service order.",
    fields: {},
  },
  "service.order_delivered": {
    label: "Service delivered",
    description: "An administrator marked a service order Delivered.",
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
  "onboarding.invite_requested": {
    label: "Setup email requested again",
    description: "An administrator, or the customer through the \"send me a new link\" form, asked for a fresh setup email.",
    fields: {},
  },
  "onboarding.completed": {
    label: "Onboarding completed",
    description: "The customer finished every setup step: details, authorized website, and a CRM destination that passed its test.",
    fields: {},
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
  "document.sent": {
    label: "Document sent",
    description: "A document from your library was sent to a client with a secure link.",
    fields: { document_id: [] },
  },
  "document.signed": {
    label: "Document signed",
    description: "A client signed a document. The signed copy and its certificate are in the document's history.",
    fields: { document_id: [] },
  },
  "document.signature_declined": {
    label: "Signature declined",
    description: "A client declined to sign a document.",
    fields: { document_id: [] },
  },
  "document.signature_expired": {
    label: "Signature request expired",
    description: "A signature request reached its expiry date without being signed.",
    fields: { document_id: [] },
  },
  "form.submitted": {
    label: "Form submitted",
    description: "Someone submitted one of your forms. Conditions can test form_id and answer.<key> for dropdown and radio questions; documents can use {{form.<key>}} merge fields.",
    fields: { form_id: [] },
  },
  "appointment.booked": {
    label: "Appointment booked",
    description: "Someone booked an appointment on the booking page, or staff booked one. Conditions can test source (public or staff).",
    fields: { source: ["public", "staff"] },
  },
  "appointment.rescheduled": {
    label: "Appointment rescheduled",
    description: "An appointment was moved to another time by the client or by staff.",
    fields: { source: ["public", "staff"] },
  },
  "appointment.cancelled": {
    label: "Appointment cancelled",
    description: "An appointment was cancelled by the client or by staff.",
    fields: { source: ["public", "staff"] },
  },
  "appointment.done": {
    label: "Appointment attended",
    description: "Staff marked an appointment as attended.",
    fields: { source: ["public", "staff"] },
  },
  "appointment.no_show": {
    label: "Appointment no-show",
    description: "Staff marked an appointment as a no-show.",
    fields: { source: ["public", "staff"] },
  },
  "invoice.paid": {
    label: "Invoice paid",
    description: "A client's invoice was marked paid in full.",
    fields: {},
  },
  "invoice.overdue": {
    label: "Invoice overdue",
    description: "An invoice is past its due date and still unpaid. Raised once per invoice, the morning after it falls due.",
    fields: {},
  },
  "contact.tag_added": {
    label: "Tag added to a person",
    description: "Someone added a tag to a lead or client. Conditions can test which tag. Tags added by a workflow don't start another workflow.",
    fields: { tag: [] },
  },
  "contact.tag_removed": {
    label: "Tag removed from a person",
    description: "Someone removed a tag from a lead or client. Conditions can test which tag. Tags removed by a workflow don't start another workflow.",
    fields: { tag: [] },
  },
  "return.stage_changed": {
    label: "Return moved to a new stage",
    description: "A client's return moved to another stage on the returns board. Conditions can test the stage_id it moved to.",
    fields: { stage_id: [] },
  },
  "work.stage_changed": {
    label: "Work moved to a new stage",
    description: "A piece of work (planning, bookkeeping, payroll...) moved to another stage on the Work board. Conditions can test the stage_id it moved to and the pipeline_id it is in.",
    fields: { stage_id: [], pipeline_id: [] },
  },
  "date.return_due": {
    label: "Days before or after a return's due date",
    description: "Starts a set number of days before (negative) or after the due date of each open return. Choose the number of days when you set up the workflow.",
    fields: {},
  },
};

/** Condition fields whose values are a tenant's own records (checked against them when a workflow is saved). */
export const RECORD_FIELDS: Record<string, "document" | "form"> = { document_id: "document", form_id: "form" };

export const isEventType = (v: string) => Object.prototype.hasOwnProperty.call(EVENTS, v);
