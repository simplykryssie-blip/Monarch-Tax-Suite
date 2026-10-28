import type { Contact } from "./combine.ts";

/** What merging two contacts means: two clients are merged, a lead is folded into a client, or two leads are folded together. Store customers have orders and licenses, so they are never merged here. */
export type MergePlan =
  | { kind: "clients"; a: string; b: string }
  | { kind: "lead_into_client"; clientId: string; leadId: string }
  | { kind: "leads"; a: string; b: string };

export function mergePlan(a: Contact, b: Contact): MergePlan | null {
  const ac = a.refs.clientId, bc = b.refs.clientId, al = a.refs.leadId, bl = b.refs.leadId;
  if (ac && bc) return { kind: "clients", a: ac, b: bc };
  if (ac && bl) return { kind: "lead_into_client", clientId: ac, leadId: bl };
  if (bc && al) return { kind: "lead_into_client", clientId: bc, leadId: al };
  if (!ac && !bc && al && bl) return { kind: "leads", a: al, b: bl };
  return null;
}
