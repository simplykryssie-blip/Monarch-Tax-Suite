import { UpdateForm } from "@/components/update/update-form";

export default async function UpdatePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="monarch-public">
      <div className="monarch-public-card">
        <div className="monarch-eyebrow">MONARCH TAX SUITE</div>
        <h1>Annual tax-year update</h1>
        <p>Enter the license key you received with your Monarch Basic Tax Calculator to see your licensed version and any available update.</p>
        {error && <p className="monarch-alert is-error">{error}</p>}
        <UpdateForm />
      </div>
    </main>
  );
}
