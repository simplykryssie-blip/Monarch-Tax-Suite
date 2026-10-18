import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth-frame";
import { MfaSetup } from "@/components/office/mfa-setup";
import { mfaState } from "@/lib/portal/server";
import { skipPortalMfaAction, startPortalMfaAction, verifyPortalMfaAction } from "../actions";

/** Two-step sign-in for a client. Optional: once turned on, a code is asked for at each sign-in. */
export default async function PortalMfa() {
  const { supabase, level, hasFactor } = await mfaState();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/portal/mfa");
  if (level === "aal2") redirect("/portal");
  return (
    <AuthFrame>
      <div>
        <h1>{hasFactor ? "Two-step sign-in" : "Add two-step sign-in"}</h1>
        <p className="mt-login-sub">{hasFactor ? "Enter the code from your authenticator app to open your portal." : "A code from an authenticator app on your phone, as well as your password, keeps your tax information safe even if your password is stolen."}</p>
        <MfaSetup hasFactor={hasFactor} actions={{ start: startPortalMfaAction, verify: verifyPortalMfaAction, ...(hasFactor ? {} : { skip: skipPortalMfaAction }) }} />
      </div>
    </AuthFrame>
  );
}
