import { AssignedView } from "@/components/prep/views";
import { requirePrep } from "@/lib/prep/server";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; notice?: string; error?: string }> }) {
  const ctx = await requirePrep("office", "returns.assigned");
  return <AssignedView ctx={ctx} sp={await searchParams} />;
}
