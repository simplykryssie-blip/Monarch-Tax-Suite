import { requirePortal } from "@/lib/portal/server";

export default async function PortalMessages() {
  const ctx = await requirePortal();
  const messages = await ctx.reader.messages();
  const when = (iso: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  return (
    <>
      <h1 className="office-h1">Messages</h1>
      <section className="monarch-panel" style={{ padding: 20 }}>
        {messages.length === 0 ? (
          <p className="monarch-muted">No messages yet. Emails and texts {ctx.office.name} sends you will be listed here.</p>
        ) : (
          <ul className="portal-list">
            {messages.map((m) => (
              <li key={m.id}>
                <b>{m.direction === "in" ? "You" : ctx.office.name}</b> <span className="monarch-muted">· {m.channel === "sms" ? "Text" : m.channel === "portal" ? "Message" : "Email"} · {when(m.occurred_at)}</span>
                {m.subject && <div><b>{m.subject}</b></div>}
                <p style={{ whiteSpace: "pre-wrap", margin: "4px 0 0" }}>{m.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
