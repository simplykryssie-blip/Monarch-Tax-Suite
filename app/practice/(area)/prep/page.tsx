import { PrepBoardView } from "@/components/prep/views";
import { requirePrep } from "@/lib/prep/server";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; notice?: string; error?: string }> }) {
  const ctx = await requirePrep("practice", "returns.prep");
  return <PrepBoardView ctx={ctx} sp={await searchParams} />;
}
