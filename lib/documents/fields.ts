// Merge fields a document template may use. A fixed list, like email placeholders: a name that is not here is refused
// at upload, so a typo can never reach a customer.

export type FieldGroup = "client" | "firm" | "purchase" | "date" | "signing";

export const MERGE_FIELDS: Record<string, { label: string; group: FieldGroup }> = {
  client_name: { label: "The client's full name", group: "client" },
  client_first_name: { label: "The client's first name", group: "client" },
  client_email: { label: "The client's email address", group: "client" },
  client_business_name: { label: "The client's business name", group: "client" },
  firm_name: { label: "Your firm's display name", group: "firm" },
  firm_legal_name: { label: "Your firm's legal name", group: "firm" },
  firm_email: { label: "Your firm's email address", group: "firm" },
  firm_phone: { label: "Your firm's phone number", group: "firm" },
  firm_address: { label: "Your firm's mailing address", group: "firm" },
  order_number: { label: "The order number", group: "purchase" },
  order_date: { label: "The order date", group: "purchase" },
  product_name: { label: "The product or package bought", group: "purchase" },
  amount_paid: { label: "The amount paid", group: "purchase" },
  today: { label: "Today's date (your time zone)", group: "date" },
  current_year: { label: "The current year", group: "date" },
  signer_name: { label: "The signer's printed name (filled when they sign; PDF only)", group: "signing" },
  signed_date: { label: "The date they signed (filled when they sign; PDF only)", group: "signing" },
};

/** The PDF form field where the signature is placed, when a template has one. Not a merge field. */
export const SIGNATURE_FIELD = "signature";

export const SIGNING_FIELDS = Object.keys(MERGE_FIELDS).filter((k) => MERGE_FIELDS[k].group === "signing");
export const isMergeField = (name: string) => Object.prototype.hasOwnProperty.call(MERGE_FIELDS, name);

/** Values for a preview with obviously fake data. */
export const SAMPLE_FIELD_VALUES: Record<string, string> = {
  client_name: "Sample Client",
  client_first_name: "Sample",
  client_email: "client@example.com",
  client_business_name: "Sample Tax Office LLC",
  firm_name: "Your Firm",
  firm_legal_name: "Your Firm LLC",
  firm_email: "office@example.com",
  firm_phone: "(555) 010-0000",
  firm_address: "100 Example Street, Example City, ST 00000",
  order_number: "1000",
  order_date: "January 1, 2027",
  product_name: "Sample Package",
  amount_paid: "$0.00",
  today: "January 1, 2027",
  current_year: "2027",
  signer_name: "Sample Client",
  signed_date: "January 1, 2027",
};
