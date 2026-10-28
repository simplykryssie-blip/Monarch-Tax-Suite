import Link from "next/link";
import { joinAction } from "../../actions";
import { labContext, labRepo } from "@/lib/lab/server";
import { inviteFor } from "@/lib/lab/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join your class" };

/** Public: the one-time link an instructor sends a student. The token is the credential; only its hash is stored. */
export default async function JoinPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams?: Promise<{ error?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const invite = await inviteFor(labRepo(), token, new Date()).catch(() => null);
  const ctx = await labContext().catch(() => null);
  if (!invite) {
    return (
      <div className="lab-wrap"><main className="lab-main"><div className="lab-card lab-stack" style={{ maxWidth: 560 }}>
        <h1>This link has expired</h1>
        <p className="lab-muted">Invitation links work once and last 30 days. Ask your instructor to send you a new one.</p>
        <Link className="lab-btn" href="/login?next=/lab">Sign in</Link>
      </div></main></div>
    );
  }
  return (
    <div className="lab-wrap"><main className="lab-main"><div className="lab-card lab-stack" style={{ maxWidth: 560 }}>
      <span className="lab-eyebrow">Monarch Tax Lab</span>
      <h1>Join your class</h1>
      <p className="lab-muted">Your instructor invited <b>{invite.member.email}</b> to practice 2026 tax returns in Monarch Tax Lab.</p>
      {sp?.error ? <div className="lab-notice bad" role="alert">{sp.error.slice(0, 300)}</div> : null}
      <form action={joinAction} className="lab-stack">
        <input type="hidden" name="token" value={token} />
        <label className="f">Your name<input type="text" name="name" maxLength={120} autoComplete="name" /></label>
        {ctx ? (
          <p className="lab-small lab-muted">You’ll join as {ctx.email}.</p>
        ) : (
          <>
            <label className="f">Email<input type="email" name="email" required autoComplete="email" defaultValue={invite.member.email} /></label>
            <label className="f">Create a password <span className="hint">(at least 12 characters)</span><input type="password" name="password" required minLength={12} autoComplete="new-password" /></label>
          </>
        )}
        <button type="submit" className="lab-btn primary">Join class</button>
      </form>
      {!ctx ? <p className="lab-small lab-muted">Already have an account? <Link href={`/login?next=/lab/join/${encodeURIComponent(token)}`}>Sign in first</Link>, then open this link again.</p> : null}
    </div></main></div>
  );
}
