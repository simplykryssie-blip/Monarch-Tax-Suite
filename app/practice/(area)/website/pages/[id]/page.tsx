import { PageEditorView } from "@/components/sites/views";
import { requireSites } from "@/lib/sites/context";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  return <PageEditorView ctx={await requireSites("practice")} id={(await params).id} sp={await searchParams} />;
}
