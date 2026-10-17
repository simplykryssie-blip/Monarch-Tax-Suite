import { requirePractice } from "@/lib/practice/server";

export default async function PracticeHome() {
  const ctx = await requirePractice();
  return (
    <section className="monarch-panel" style={{ padding: 20 }}>
      <h1 style={{ marginTop: 0 }}>Welcome, {ctx.member.full_name}</h1>
      <p>Your workspace is ready. Your clients, prep work and assigned returns will appear here.</p>
    </section>
  );
}
