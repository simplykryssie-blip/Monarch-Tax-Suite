import { redirect } from "next/navigation";

// Addresses now live under Site settings.
export default async function Page({ params }: { params: Promise<{ siteId: string }> }) {
  redirect(`/sites/${(await params).siteId}/settings`);
}
