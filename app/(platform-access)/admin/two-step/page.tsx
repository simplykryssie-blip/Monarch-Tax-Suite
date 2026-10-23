import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth-frame";
import { MfaSetup } from "@/components/office/mfa-setup";
import { isAdminUser } from "@/lib/admin";
import { signOut } from "@/lib/auth-actions";
import { twoStepScreen } from "@/lib/admin-two-step.ts";
import { mfaState } from "@/lib/office/server";
import { startAdminTwoStepAction, verifyAdminTwoStepAction } from "./actions";

export const metadata: Metadata = { title: "Two-step sign-in", robots: { index: false, follow: false } };

/**
 * Two-step sign-in for the platform administrator: set up an authenticator (first time), or enter a code (each sign-in).
 * It lives outside the /admin frame and guard on purpose, so it can be reached before the guard lets anyone in. It changes
 * only the signed-in person's own authenticator, so it needs no administrator check.
 */
export default async function AdminTwoStepPage() {
  const state = await mfaState();
  const { data: { user } } = await state.supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/two-step");
  const screen = twoStepScreen(state, await isAdminUser(user.id));
  if (screen === "open") redirect("/admin/workspaces");
  if (screen === "done") {
    return (
      <AuthFrame>
        <div>
          <h1>Two-step sign-in is on</h1>
          <p className="mt-login-sub">Signed in as {user.email}. Your authenticator is set up. This account is not a platform administrator yet; once it is, you will enter a code from your authenticator app at each sign-in.</p>
          <form action={signOut}><button type="submit" className="monarch-link">Sign out</button></form>
        </div>
      </AuthFrame>
    );
  }
  const enroll = screen === "enroll";
  return (
    <AuthFrame>
      <div>
        <h1>{enroll ? "Set up two-step sign-in" : "Two-step sign-in"}</h1>
        <p className="mt-login-sub">{enroll
          ? "The platform administrator signs in with a password and a code from an authenticator app. This is required and cannot be skipped."
          : "Enter the code from your authenticator app to open the platform admin."}</p>
        <MfaSetup hasFactor={!enroll} actions={{ start: startAdminTwoStepAction, verify: verifyAdminTwoStepAction }} />
        {/* Never trapped on this screen: a person who cannot finish setup can still sign out. */}
        <form action={signOut}><button type="submit" className="monarch-link">Sign out</button></form>
      </div>
    </AuthFrame>
  );
}
