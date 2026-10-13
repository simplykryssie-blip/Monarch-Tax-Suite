import Link from "next/link";
import { AuthFrame } from "@/components/auth-frame";
import { AcceptInvite } from "@/components/office/accept-invite";
import { createClient } from "@/lib/supabase/server";
import { inviteFor } from "@/lib/office/service.ts";
import { memberForInviteHash, officeDeps } from "@/lib/office/server";

export const metadata = { title: "Office invite", robots: { index: false, follow: false } };

/** An office invite link. Anyone with the link can see which office it's for; accepting needs the invited email. */
export default async function OfficeInvite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const member = await inviteFor(token, memberForInviteHash).catch(() => null);
  const office = member ? (await officeDeps(member.tenant_id).repo.listOffices().catch(() => [])).find((o) => o.id === member.organization_id) : null;
  const { data: { user } } = await (await createClient()).auth.getUser();
  return (
    <AuthFrame>
      <div>
        {!member || !office ? (
          <>
            <h1>This invite can&apos;t be used</h1>
            <p className="mt-login-sub">It has expired, was already accepted, or was withdrawn. Ask whoever invited you to send a new one.</p>
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
