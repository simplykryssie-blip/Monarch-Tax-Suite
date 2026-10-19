import Link from "next/link";
import { AuthFrame } from "@/components/auth-frame";
import { AcceptInvite } from "@/components/office/accept-invite";
import { createClient } from "@/lib/supabase/server";
import { checkInvite, cleanToken, type InviteCheck } from "@/lib/office/service.ts";
import { memberForInviteHash, officeDeps } from "@/lib/office/server";

export const metadata = { title: "Office invite", robots: { index: false, follow: false } };

/** An office invite link. Anyone with the link can see which office it's for; accepting needs the invited email. */
export default async function OfficeInvite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let check: InviteCheck<NonNullable<Awaited<ReturnType<typeof memberForInviteHash>>>> = { member: null, reason: "not_found" };
  try {
    check = await checkInvite(token, memberForInviteHash);
  } catch (e) {
    console.error(`office invite lookup failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
  }
  const member = check.member;
  const office = member ? (await officeDeps(member.tenant_id).repo.listOffices().catch(() => [])).find((o) => o.id === member.organization_id) : null;
  // What went wrong, without the token itself: only its length and whether it has the right shape.
  if (!member || !office) console.info(JSON.stringify({ event: "office_invite_unusable", reason: member ? "office_not_found" : check.reason, token_length: token.length, token_clean: cleanToken(token) !== null }));
  const why = member && !office ? "That office is no longer available." : check.reason === "expired" ? "This invite has expired (links work for 7 days)." : check.reason === "malformed" ? "This link looks incomplete. Copy the whole link, including the last characters, and open it again." : "This link isn't active any more: it was already used, was withdrawn, or a newer invite replaced it.";
  const { data: { user } } = await (await createClient()).auth.getUser();
  return (
    <AuthFrame>
      <div>
        {!member || !office ? (
          <>
            <h1>This invite can&apos;t be used</h1>
            <p className="mt-login-sub">{why} Ask whoever invited you to send a new one.</p>
            <Link className="monarch-secondary" href="/login">Go to sign in</Link>
          </>
        ) : (
          <>
            <h1>Join {office.name}</h1>
            <p className="mt-login-sub">You&apos;re invited as {member.role === "ero" ? "the office's ERO" : "a preparer"}. After this, you&apos;ll turn on two-step sign-in.</p>
            <AcceptInvite token={token} email={member.email} signedInAs={user?.email ?? null} />
          </>
        )}
      </div>
    </AuthFrame>
  );
}
