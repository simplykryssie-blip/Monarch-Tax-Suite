export const CASE_TYPES = [
  { value: "tax_return", label: "Tax Return" },
  { value: "bookkeeping", label: "Bookkeeping" },
  { value: "payroll", label: "Payroll" },
  { value: "business_service", label: "Business Service" },
  { value: "other", label: "Other" },
] as const;

export const CASE_STATUSES = [
  "New",
  "Waiting On Client",
  "Waiting On Staff",
  "In Progress",
  "Waiting On Review",
  "Corrections Requested",
  "Approved",
  "Waiting On Signature",
  "Waiting On Payment",
  "Ready To Release",
  "Completed",
  "Archived",
] as const;

export function caseTypeLabel(value: string) {
  return CASE_TYPES.find((t) => t.value === value)?.label ?? value;
}
