import Link from "next/link";
import { MfaSetup } from "@/components/office/mfa-setup";
import { Flash, PageTitle } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin";
import { mfaState } from "@/lib/office/server";
import { enrollWorkspaceTwoStepAction, removeWorkspaceTwoStepAction, startWorkspaceTwoStepAction } from "@/app/two-step/actions";

/** Protecting the sign-in: a second step (a code from an authenticator app) and the password. */
export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const { hasFactor } = await mfaState();
  return (
    <>
      <PageTitle title="Security">Keep client information safe even if a password is stolen.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Two-step sign-in</h2>
        {hasFactor ? (
          <>
            <p>Two-step sign-in is <b>on</b>. You&apos;re asked for a code from your authenticator app each time you sign in.</p>
            <form action={removeWorkspaceTwoStepAction} data-confirm="Turn off two-step sign-in? Your account will be protected by the password alone.">
              <button className="monarch-secondary">Remove two-step sign-in</button>
            </form>
          </>
        ) : (
          <>
            <p>Two-step sign-in is <b>off</b>. We strongly recommend turning it on. It takes about a minute, and you&apos;ll need an authenticator app on your phone.</p>
            <MfaSetup hasFactor={false} actions={{ start: startWorkspaceTwoStepAction, verify: enrollWorkspaceTwoStepAction }} />
          </>
        )}
      </section>
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Password</h2>
        <p><Link href="/reset-password">Change your password</Link></p>
      </section>
    </>
  );
}
