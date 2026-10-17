import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth-frame";
import { MfaSetup } from "@/components/office/mfa-setup";
import { mfaState } from "@/lib/practice/server";
import { skipPracticeMfaAction, startPracticeMfaAction, verifyPracticeMfaAction } from "../actions";

/**
 * Two-step sign-in for a holder. Not turned on: it is offered, strongly recommended, and can be skipped. Turned on: a
 * code is needed at each sign-in (no skip).
 */
export default async function PracticeMfa() {
  const { supabase, level, hasFactor } = await mfaState();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/practice/mfa");
  if (level === "aal2") redirect("/practice");
  return (
    <AuthFrame>
      <div>
        <h1>{hasFactor ? "Two-step sign-in" : "Add two-step sign-in"}</h1>
        <p className="mt-login-sub">{hasFactor
          ? "Enter the code from your authenticator app to open your workspace."
          : "We strongly recommend it. A code from an authenticator app on your phone, as well as your password, keeps client information safe even if your password is stolen. It takes about a minute, and you can turn it on later from Security in the menu."}</p>
        <MfaSetup hasFactor={hasFactor} actions={{ start: startPracticeMfaAction, verify: verifyPracticeMfaAction, ...(hasFactor ? {} : { skip: skipPracticeMfaAction }) }} />
      </div>
    </AuthFrame>
  );
}
