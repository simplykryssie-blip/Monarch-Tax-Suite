import { MfaSetup } from "@/components/office/mfa-setup";
import { mfaState, requirePortal } from "@/lib/portal/server";
import { startPortalMfaAction, verifyPortalMfaAction } from "../../actions";

/** Where a client turns on two-step sign-in. It is optional; once on, a code is asked for at each sign-in. */
export default async function PortalSecurity() {
  await requirePortal();
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
            <p>Two-step sign-in is <b>off</b>. Turning it on protects your tax information even if your password is stolen. It takes about a minute.</p>
            <MfaSetup hasFactor={false} actions={{ start: startPortalMfaAction, verify: verifyPortalMfaAction }} />
          </>
        )}
      </section>
    </>
  );
}
