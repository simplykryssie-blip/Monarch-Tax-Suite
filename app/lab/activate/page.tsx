import Link from "next/link";
import { activateAction } from "../actions";
import { labContext } from "@/lib/lab/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activate your license" };

/** Public: activates a Monarch Tax Lab license key, creating the account if the person doesn't have one. */
export default async function ActivatePage({ searchParams }: { searchParams?: Promise<{ error?: string; confirm?: string }> }) {
  const sp = await searchParams;
  const ctx = await labContext().catch(() => null);
  const error = sp?.error?.slice(0, 300);
  if (sp?.confirm) {
    return (
      <div className="lab-wrap"><main className="lab-main"><div className="lab-card lab-stack" style={{ maxWidth: 560 }}>
        <span className="lab-eyebrow">Almost done</span>
        <h1>Check your email</h1>
        <p>We sent a confirmation link to your email address. Open it, sign in, and your license will be ready in Monarch Tax Lab.</p>
        <p className="lab-muted lab-small">No email after a few minutes? Check your spam folder, or write to support@verexahq.com.</p>
        <Link className="lab-btn primary" href="/login?next=/lab">Go to sign in</Link>
      </div></main></div>
    );
  }
  return (
    <div className="lab-wrap"><main className="lab-main"><div className="lab-card lab-stack" style={{ maxWidth: 560 }}>
      <span className="lab-eyebrow">Monarch Tax Lab</span>
      <h1>Activate your license</h1>
      <p className="lab-muted">Enter the license key from your purchase email. {ctx ? "It will be added to the account you’re signed in to." : "You’ll create the account you use to sign in to Monarch Tax Lab."}</p>
      {ctx?.membership ? <div className="lab-notice">You already have an active license. <Link href="/lab">Go to your scenarios</Link>, or activate another key below.</div> : null}
      {error ? <div className="lab-notice bad" role="alert">{error}</div> : null}
      <form action={activateAction} className="lab-stack">
        <label className="f">License key<input type="text" name="key" required autoComplete="off" placeholder="MTS-XXXXX-XXXXX-XXXXX-XXXXX" style={{ fontFamily: "var(--l-num)", textTransform: "uppercase" }} /></label>
        <label className="f">Your name<input type="text" name="name" maxLength={120} autoComplete="name" /></label>
        {ctx ? (
          <p className="lab-small lab-muted">Signed in as {ctx.email}.</p>
        ) : (
          <>
            <label className="f">Email<input type="email" name="email" required autoComplete="email" /></label>
            <label className="f">Create a password <span className="hint">(at least 12 characters)</span><input type="password" name="password" required minLength={12} autoComplete="new-password" /></label>
          </>
        )}
        <button type="submit" className="lab-btn primary">Activate</button>
      </form>
      {!ctx ? <p className="lab-small lab-muted">Already have an account? <Link href="/login?next=/lab/activate">Sign in first</Link>, then come back to activate.</p> : null}
    </div></main></div>
  );
}
