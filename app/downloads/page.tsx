import type { Metadata } from "next";
import { DownloadsForm } from "@/components/downloads/downloads-form";

export const metadata: Metadata = { title: "Downloads | Monarch Tax Suite", robots: { index: false, follow: false } };

/** Buyer downloads. Files are delivered only to an active license with a paid order, and only as downloads. */
export default async function DownloadsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="monarch-public">
      <div className="monarch-public-card">
        <div className="monarch-eyebrow">MONARCH TAX SUITE</div>
        <h1>Your downloads</h1>
        <p>Enter the license key you received with your purchase to download your files.</p>
        {error && <p className="monarch-alert is-error">{error.slice(0, 300)}</p>}
        <DownloadsForm />
      </div>
    </main>
  );
}
