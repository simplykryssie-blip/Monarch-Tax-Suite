import { ClientView } from "@/components/prep/views";
import { requirePrep } from "@/lib/prep/server";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const ctx = await requirePrep("practice", "clients.intake");
  const { id } = await params;
  return <ClientView ctx={ctx} id={id} sp={await searchParams} />;
}
