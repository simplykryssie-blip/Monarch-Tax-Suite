import Link from "next/link";
import { mfaState, requirePractice } from "@/lib/practice/server";
import { shouldRecommendMfa } from "@/lib/practice/mfa.ts";

export default async function PracticeHome() {
  const ctx = await requirePractice();
  const mfa = await mfaState();
  return (
    <>
      {shouldRecommendMfa(mfa) && (
        <p className="monarch-notice" role="note"><b>RECOMMENDED</b> Turn on two-step sign-in to protect your clients&apos; information. <Link href="/practice/security">Turn it on</Link></p>
      )}
      <section className="monarch-panel" style={{ padding: 20 }}>
        <h1 style={{ marginTop: 0 }}>Welcome, {ctx.member.full_name}</h1>
        <p>Your workspace is ready. Your clients, prep work and assigned returns will appear here.</p>
      </section>
    </>
  );
}
