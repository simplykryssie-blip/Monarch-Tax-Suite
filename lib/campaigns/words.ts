import type { MergeWordList } from "../ui/merge-words.ts";

/** The merge tags a campaign can use, with the words a person sees for each (see CAMPAIGN_VARIABLES for what each means). */
export const CAMPAIGN_WORDS: MergeWordList = [
  { key: "first_name", label: "First name" },
  { key: "name", label: "Full name" },
  { key: "office_name", label: "Office name" },
  { key: "office_phone", label: "Office phone" },
  { key: "office_email", label: "Office email" },
];
