"use client";

import { useState } from "react";
import { sendMessageAction, sendPortalMessageAction } from "@/app/(admin)/workspace/actions";
import { SubmitOnce } from "@/components/admin/submit-once";
import { SMS_MAX } from "@/lib/automation/sms.ts";
import { segmentCount } from "@/lib/automation/twilio.ts";

type Channel = "email" | "sms" | "portal";
export type ChannelState = { to: string | null; problem: string | null };

/**
 * One place to write to a client: Email (subject and message), Text (a short message with its length counted) or Portal
 * (a message in their portal). Each channel shows only what it needs, and says so when it can't send yet.
 */
export function MessageComposer({ clientId, email, sms, portal, credits }: { clientId: string; email: ChannelState; sms: ChannelState; portal: ChannelState; credits: number | null }) {
  const [channel, setChannel] = useState<Channel>("email");
  const [text, setText] = useState("");
  const state = channel === "email" ? email : channel === "sms" ? sms : portal;
  const segments = segmentCount(text);
  const label: Record<Channel, string> = { email: "Email", sms: "Text", portal: "Portal" };
  return (
    <form action={channel === "portal" ? sendPortalMessageAction : sendMessageAction} className="monarch-form mc-form">
      <input type="hidden" name="client_id" value={clientId} />
      {channel !== "portal" && <input type="hidden" name="channel" value={channel} />}
      <div className="is-wide ac-kinds" role="group" aria-label="How to send">
        {(["email", "sms", "portal"] as const).map((c) => <button key={c} type="button" aria-pressed={channel === c} className={channel === c ? "is-on" : undefined} onClick={() => setChannel(c)}>{label[c]}</button>)}
      </div>
      {state.problem ? <p className="is-wide monarch-muted">{state.problem}</p> : (
        <>
          <p className="is-wide mc-to">To {state.to}</p>
          {channel !== "sms" && <label className="is-wide">Subject{channel === "email" ? " *" : ""}<input name="subject" required={channel === "email"} maxLength={200} /></label>}
          <label className="is-wide">Message *<textarea name="body" required rows={channel === "sms" ? 4 : 7} maxLength={channel === "sms" ? SMS_MAX : 4000} value={text} onChange={(e) => setText(e.target.value)} /></label>
          {channel === "sms" && <small className="is-wide monarch-muted">{text.length} of {SMS_MAX} characters · {segments} {segments === 1 ? "message" : "messages"}{credits !== null ? ` · ${credits} credits left` : ""}</small>}
          <div className="is-wide"><SubmitOnce className="monarch-primary" busy="Sending…">Send {label[channel].toLowerCase()}</SubmitOnce></div>
        </>
      )}
    </form>
  );
}
