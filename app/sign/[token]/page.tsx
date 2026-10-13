import type { Metadata } from "next";
import { canStillSign, linkContext, STATE_TEXT } from "@/lib/documents/public";
import { recordView } from "@/lib/documents/service.ts";
import { SignForm } from "@/components/sign/sign-form";
import { downloadSignedAction } from "./actions";

export const metadata: Metadata = { title: "Review and sign", robots: { index: false, follow: false } };

/** The signing page. The secure link is the credential; the document is shown through a 60-second file link. */
export default async function SignPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  const { token } = await params;
  const { error, done } = await searchParams;
  const ctx = await linkContext(token);
  const firm = ctx?.profile?.display_name ?? "";
  let body: React.ReactNode;
  if (!ctx || !ctx.state.ok || !ctx.state.signature) {
    body = <p>{STATE_TEXT[ctx && !ctx.state.ok ? ctx.state.reason : "not_found"]}</p>;
  } else {
    const { document, signature } = ctx.state;
    if (signature.status === "signed") {
      body = (
        <>
          <h1>{done === "signed" ? "Thank you, it is signed" : "Already signed"}</h1>
          <p>You signed &ldquo;{document.name}&rdquo;. A copy with its signing certificate is available here for 30 days{done === "signed" ? ", and we emailed you the link" : ""}.</p>
          {error && <p className="monarch-alert is-error">{error.slice(0, 300)}</p>}
          <form action={downloadSignedAction}><input type="hidden" name="token" value={token} /><button className="monarch-primary">Download the signed copy</button></form>
        </>
      );
    } else if (signature.status === "declined") {
      body = <><h1>Declined</h1><p>You declined to sign &ldquo;{document.name}&rdquo;. {firm || "The sender"} has been told.</p></>;
    } else if (!canStillSign(signature)) {
      body = <p>{signature.status === "voided" ? STATE_TEXT.revoked : STATE_TEXT.expired}</p>;
    } else {
      await recordView(ctx.deps, signature).catch(() => undefined);
      body = (
        <>
          <h1>{document.name}</h1>
          <p>{firm ? `${firm} asked you to review and sign this document.` : "Please review and sign this document."} Read it below, then sign at the bottom of the page.</p>
          <iframe title={document.name} src={`/sign/${token}/view`} style={{ width: "100%", height: "70vh", minHeight: 420, border: "1px solid #d9d4c7", borderRadius: 4, background: "#fff" }} />
          <p className="monarch-muted"><a href={`/sign/${token}/view`} target="_blank" rel="noreferrer">Open the document in a new tab</a> if it does not show above.</p>
          <SignForm token={token} consentText={signature.consent_text} signerName={signature.signer_name ?? ""} />
        </>
      );
    }
  }
  return (
    <main className="monarch-public">
      <div className="monarch-public-card" style={{ maxWidth: 820 }}>
        {firm && <div className="monarch-eyebrow">{firm.toUpperCase()}</div>}
        {body}
      </div>
    </main>
  );
}
