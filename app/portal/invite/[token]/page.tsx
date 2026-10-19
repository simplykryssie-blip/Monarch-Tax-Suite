import Link from "next/link";
import { AuthFrame } from "@/components/auth-frame";
import { AcceptInvite } from "@/components/office/accept-invite";
import { loadBrand } from "@/lib/branding/server";
import { cleanToken } from "@/lib/office/service.ts";
import { checkPortalInvite, type PortalInviteCheck, type PortalMember } from "@/lib/portal/service.ts";
import { portalMemberForInviteHash } from "@/lib/portal/server";
import { createClient } from "@/lib/supabase/server";
import { acceptPortalNewAccountAction, acceptPortalSignedInAction } from "../../actions";

export const metadata = { title: "Client portal invite", robots: { index: false, follow: false } };

/** A portal invite link. The link is the credential; accepting needs the invited email. */
export default async function PortalInvite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let check: PortalInviteCheck<PortalMember> = { member: null, reason: "not_found" };
  try {
    check = await checkPortalInvite(token, portalMemberForInviteHash);
  } catch (e) {
    console.error(`portal invite lookup failed: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`);
  }
  const member = check.member;
  if (!member) console.info(JSON.stringify({ event: "portal_invite_unusable", reason: check.reason, token_length: token.length, token_clean: cleanToken(token) !== null }));
  const why = check.reason === "expired" ? "This invite has expired (links work for 7 days)." : check.reason === "malformed" ? "This link looks incomplete. Copy the whole link, including the last characters, and open it again." : "This link isn't active any more: it was already used, was withdrawn, or a newer invite replaced it.";
  const { data: { user } } = await (await createClient()).auth.getUser();
  const office = member ? (await loadBrand(member.tenant_id)).name : null;
  return (
    <AuthFrame>
      <div>
        {!member ? (
          <>
            <h1>This invite can&apos;t be used</h1>
            <p className="mt-login-sub">{why} Ask your tax office to send a new one.</p>
            <Link className="monarch-secondary" href="/login">Go to sign in</Link>
          </>
        ) : (
          <>
            <h1>Set up your client portal</h1>
            <p className="mt-login-sub">{office} invited you to its secure portal, where you can see documents, sign forms and view invoices.</p>
            <AcceptInvite token={token} email={member.email} signedInAs={user?.email ?? null} actions={{ newAccount: acceptPortalNewAccountAction, signedIn: acceptPortalSignedInAction }} />
          </>
        )}
      </div>
    </AuthFrame>
  );
}
