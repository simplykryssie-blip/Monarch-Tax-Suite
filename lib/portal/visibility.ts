import type { ClientMessage } from "../workspace/types.ts";

/** Messages a client may see: emails, texts and portal messages that were actually sent to them (or that they sent). Call logs and notes stay with staff. */
export const portalMessageVisible = (m: Pick<ClientMessage, "channel" | "direction" | "status">) =>
  (m.channel === "email" || m.channel === "sms" || m.channel === "portal") && (m.direction === "in" || m.status === "sent");
