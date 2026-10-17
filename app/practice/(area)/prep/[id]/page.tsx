import { ReturnView } from "@/components/prep/views";
import { requirePrep } from "@/lib/prep/server";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const ctx = await requirePrep("practice", "returns.prep");
  const { id } = await params;
  return <ReturnView ctx={ctx} id={id} sp={await searchParams} />;
}
