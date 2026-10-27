import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth-frame";
import { MfaSetup } from "@/components/office/mfa-setup";
import { signOut } from "@/lib/auth-actions";
import { mfaState } from "@/lib/office/server";
import { startWorkspaceTwoStepAction, verifyWorkspaceTwoStepAction } from "./actions";

export const metadata: Metadata = { title: "Two-step sign-in", robots: { index: false, follow: false } };

/** The code step of sign-in for someone who turned on two-step sign-in. Outside the workspace guard so it can be reached before it lets anyone in. */
export default async function WorkspaceTwoStep() {
  const state = await mfaState();
  const { data: { user } } = await state.supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!state.hasFactor || state.level === "aal2") redirect("/");
  return (
    <AuthFrame>
      <div>
        <h1>Two-step sign-in</h1>
        <p className="mt-login-sub">Enter the code from your authenticator app to continue.</p>
        <MfaSetup hasFactor actions={{ start: startWorkspaceTwoStepAction, verify: verifyWorkspaceTwoStepAction }} />
        <form action={signOut}><button type="submit" className="monarch-link">Sign out</button></form>
      </div>
    </AuthFrame>
  );
}
