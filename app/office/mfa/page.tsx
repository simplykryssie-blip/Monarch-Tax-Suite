import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth-frame";
import { MfaSetup } from "@/components/office/mfa-setup";
import { mfaState } from "@/lib/office/server";
import { skipMfaAction, startMfaEnrollAction, verifyMfaAction } from "../actions";

/** Two-step sign-in: recommended, and the person's choice. Not turned on: it is offered and can be skipped. Turned on: a code at each sign-in. */
export default async function OfficeMfa() {
  const { supabase, level, hasFactor } = await mfaState();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/office/mfa");
  if (level === "aal2") redirect("/office");
  return (
    <AuthFrame>
      <div>
        <h1>{hasFactor ? "Two-step sign-in" : "Add two-step sign-in"}</h1>
        <p className="mt-login-sub">{hasFactor ? "Enter the code from your authenticator app to open your office." : "We recommend it: a code from an authenticator app on your phone, as well as your password, keeps client information safe even if your password is stolen. It takes about a minute, and you can skip it now."}</p>
        <MfaSetup hasFactor={hasFactor} actions={{ start: startMfaEnrollAction, verify: verifyMfaAction, ...(hasFactor ? {} : { skip: skipMfaAction }) }} />
      </div>
    </AuthFrame>
  );
}
