import type { Metadata } from "next";
import { linkContext, STATE_TEXT } from "@/lib/documents/public";
import { markOpened } from "@/lib/documents/service.ts";
import { downloadDocumentAction } from "./actions";

export const metadata: Metadata = { title: "Your document", robots: { index: false, follow: false } };

/** A document a firm sent. The secure link is the credential; the file itself comes through a 60-second link. */
export default async function DocumentLinkPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const ctx = await linkContext(token);
  const firm = ctx?.profile?.display_name ?? "";
  let body: React.ReactNode;
  if (!ctx || !ctx.state.ok) {
    body = <p>{STATE_TEXT[ctx && !ctx.state.ok ? ctx.state.reason : "not_found"]}</p>;
  } else if (ctx.state.delivery.kind === "signature") {
    body = <p><a className="monarch-primary" href={`/sign/${token}`}>Open the signing page</a></p>;
  } else {
    await markOpened(ctx.deps, ctx.state.delivery).catch(() => undefined);
    body = (
      <>
        <h1>{ctx.state.document.name}</h1>
        <p>{firm ? `${firm} sent you this document.` : "This document was sent to you."} The download link below is personal to you.</p>
        {error && <p className="monarch-alert is-error">{error.slice(0, 300)}</p>}
        <form action={downloadDocumentAction}>
          <input type="hidden" name="token" value={token} />
          <button className="monarch-primary">Download {ctx.state.document.file_type === "pdf" ? "PDF" : "Word document"}</button>
        </form>
      </>
    );
  }
  return (
    <main className="monarch-public">
      <div className="monarch-public-card">
        {firm && <div className="monarch-eyebrow">{firm.toUpperCase()}</div>}
        {body}
      </div>
    </main>
  );
}
