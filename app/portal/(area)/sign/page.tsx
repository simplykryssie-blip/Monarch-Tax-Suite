import { documentLinkKey } from "@/lib/documents/server";
import { linkToken } from "@/lib/documents/service.ts";
import { requirePortal } from "@/lib/portal/server";

const clock = () => Date.now();

const STATUS = { sent: "Waiting for your signature", viewed: "Waiting for your signature", signed: "Signed", declined: "Declined", expired: "Expired", voided: "Withdrawn" } as const;

export default async function PortalSign() {
  const ctx = await requirePortal();
  const key = documentLinkKey();
  const all = key ? await ctx.reader.signatures() : [];
  const open = all.filter((s) => (s.status === "sent" || s.status === "viewed") && Date.parse(s.expiresAt) > clock());
  const rest = all.filter((s) => !open.includes(s));
  const day = (iso: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(iso));
  const link = (id: string) => `/sign/${linkToken(key!, id)}`;
  return (
    <>
      <h1 className="office-h1">Sign</h1>
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Waiting for your signature</h2>
        {open.length === 0 ? <p className="monarch-muted">Nothing to sign right now. When {ctx.office.name} sends you a form, it will be here.</p> : (
          <ul className="portal-list">
            {open.map((s) => (
              <li key={s.deliveryId}>
                <b>{s.name}</b> <span className="monarch-muted">· sent {day(s.createdAt)} · open until {day(s.expiresAt)}</span>
                <div><a className="monarch-primary" href={link(s.deliveryId)}>Review and sign</a></div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {rest.length > 0 && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Earlier</h2>
          <ul className="portal-list">
            {rest.map((s) => (
              <li key={s.deliveryId}>
                <b>{s.name}</b> <span className="monarch-muted">· {STATUS[s.status]}{s.signedAt ? ` ${day(s.signedAt)}` : ""}</span>
                {s.status === "signed" && <div><a className="monarch-link" href={link(s.deliveryId)}>View and download the signed copy</a></div>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
