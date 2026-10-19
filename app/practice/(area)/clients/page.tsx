import { ClientsView } from "@/components/prep/views";
import { requirePrep } from "@/lib/prep/server";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; notice?: string; error?: string }> }) {
  const ctx = await requirePrep("practice", "clients.intake");
  return <ClientsView ctx={ctx} sp={await searchParams} />;
}
