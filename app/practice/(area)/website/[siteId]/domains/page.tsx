import { redirect } from "next/navigation";

// Addresses now live under Site settings.
export default async function Page({ params }: { params: Promise<{ siteId: string }> }) {
  redirect(`/practice/website/${(await params).siteId}/settings`);
}
