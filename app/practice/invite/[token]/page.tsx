import Link from "next/link";
import { AuthFrame } from "@/components/auth-frame";
import { AcceptInvite } from "@/components/office/accept-invite";
import { createClient } from "@/lib/supabase/server";
import { cleanToken } from "@/lib/office/service.ts";
import { checkInvite, type PracticeInviteCheck, type PracticeMember } from "@/lib/practice/service.ts";
import { practiceMemberForInviteHash } from "@/lib/practice/server";
import { acceptPracticeNewAccountAction, acceptPracticeSignedInAction } from "../../actions";

export const metadata = { title: "Workspace invite", robots: { index: false, follow: false } };

/** A workspace invite link. Anyone with the link can see it is an invite; accepting needs the invited email. */
export default async function PracticeInvite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let check: PracticeInviteCheck<PracticeMember & { tenant_id: string }> = { member: null, reason: "not_found" };
  try {
    check = await checkInvite(token, practiceMemberForInviteHash);
  } catch (e) {
    console.error(`practice invite lookup failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
  }
  const member = check.member;
  if (!member) console.info(JSON.stringify({ event: "practice_invite_unusable", reason: check.reason, token_length: token.length, token_clean: cleanToken(token) !== null }));
  const why = check.reason === "expired" ? "This invite has expired (links work for 7 days)." : check.reason === "malformed" ? "This link looks incomplete. Copy the whole link, including the last characters, and open it again." : "This link isn't active any more: it was already used, was withdrawn, or a newer invite replaced it.";
  const { data: { user } } = await (await createClient()).auth.getUser();
  return (
    <AuthFrame>
      <div>
        {!member ? (
          <>
            <h1>This invite can&apos;t be used</h1>
            <p className="mt-login-sub">{why} Ask whoever invited you to send a new one.</p>
            <Link className="monarch-secondary" href="/login">Go to sign in</Link>
          </>
        ) : (
          <>
            <h1>Set up your workspace</h1>
            <p className="mt-login-sub">You&apos;re invited to your own PTIN workspace. After this, you&apos;ll turn on two-step sign-in.</p>
            <AcceptInvite token={token} email={member.email} signedInAs={user?.email ?? null} actions={{ newAccount: acceptPracticeNewAccountAction, signedIn: acceptPracticeSignedInAction }} />
          </>
        )}
      </div>
    </AuthFrame>
  );
}
