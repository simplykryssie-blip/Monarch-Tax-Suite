import { MfaSetup } from "@/components/office/mfa-setup";
import { mfaState, requirePractice } from "@/lib/practice/server";
import { startPracticeMfaAction, verifyPracticeMfaAction } from "@/app/practice/actions";

/** Where a holder turns on two-step sign-in later. It is optional; once on, a code is asked for at each sign-in. */
export default async function PracticeSecurity() {
  await requirePractice();
  const { hasFactor } = await mfaState();
  return (
    <>
      <h1 className="office-h1">Security</h1>
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Two-step sign-in</h2>
        {hasFactor ? (
          <p>Two-step sign-in is <b>on</b>. You&apos;ll be asked for a code from your authenticator app each time you sign in.</p>
        ) : (
          <>
            <p>Two-step sign-in is <b>off</b>. We strongly recommend turning it on: it protects your clients&apos; information even if your password is stolen. It takes about a minute.</p>
            <MfaSetup hasFactor={false} actions={{ start: startPracticeMfaAction, verify: verifyPracticeMfaAction }} />
          </>
        )}
      </section>
    </>
  );
}
