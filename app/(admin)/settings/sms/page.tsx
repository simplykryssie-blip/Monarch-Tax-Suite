import { redirect } from "next/navigation";

/** Text messaging now lives with email, on one page. Old links and bookmarks land there, keeping anything they carried. */
export default async function SmsSettingsRedirect({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString();
  redirect(`/settings/email${qs ? `?${qs}` : ""}#text`);
}
