import { PageEditorView } from "@/components/sites/views";
import { requireSite } from "@/lib/sites/context";

export default async function Page({ params, searchParams }: { params: Promise<{ siteId: string; id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const p = await params;
  return <PageEditorView ctx={await requireSite("practice", p.siteId)} id={p.id} sp={await searchParams} />;
}
