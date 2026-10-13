import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth-frame";
import { MfaSetup } from "@/components/office/mfa-setup";
import { mfaState } from "@/lib/office/server";

/** Two-step sign-in: set it up the first time, then a code at each sign-in. Required before the office area opens. */
export default async function OfficeMfa() {
  const { supabase, level, hasFactor } = await mfaState();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/office/mfa");
  if (level === "aal2") redirect("/office");
  return (
    <AuthFrame>
      <div>
        <h1>{hasFactor ? "Two-step sign-in" : "Turn on two-step sign-in"}</h1>
        <p className="mt-login-sub">{hasFactor ? "Enter the code from your authenticator app to open your office." : "Every account that can reach client data needs it, as the FTC Safeguards Rule requires. It takes about a minute."}</p>
        <MfaSetup hasFactor={hasFactor} />
      </div>
    </AuthFrame>
  );
}
