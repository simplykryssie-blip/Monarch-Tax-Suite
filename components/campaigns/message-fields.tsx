"use client";

import { useState } from "react";
import { MergeField } from "@/components/ui/merge-field";
import { CAMPAIGN_WORDS } from "@/lib/campaigns/words.ts";
import { toFriendlyWith } from "@/lib/ui/merge-words.ts";

/** A campaign's subject (email only) and message, each with its own Insert menu. The words are converted back to merge tags when saved. */
export function CampaignMessageFields({ channel, subject, body, rows, footnote }: { channel: "email" | "sms"; subject: string; body: string; rows: number; footnote: string }) {
  const [s, setS] = useState(toFriendlyWith(CAMPAIGN_WORDS, subject));
  const [b, setB] = useState(toFriendlyWith(CAMPAIGN_WORDS, body));
  return (
    <>
      {channel === "email" && <MergeField label="Subject" name="subject" words={CAMPAIGN_WORDS} value={s} onChange={setS} maxLength={200} hint="Be honest: the subject must match what is inside. No fake “Re:” or “urgent” tricks." />}
      <MergeField label="Message" name="body" words={CAMPAIGN_WORDS} value={b} onChange={setB} maxLength={20000} multiline rows={rows} hint={footnote} />
    </>
  );
}
