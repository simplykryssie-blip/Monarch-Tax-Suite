import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { Flash, load, PageTitle, SetupRequired } from "@/components/admin/ui";
import { FeesImport } from "@/components/admin/fees-import";
import { RETURN_FIELDS } from "@/lib/fees/csv.ts";
import { defaultTaxYear } from "@/lib/fees/engine.ts";
import { feesDeps } from "@/lib/fees/server";
import { FeesNav, UUID } from "../parts";

export default async function ImportReturnsPage({ searchParams }: { searchParams: Promise<{ office?: string; notice?: string; error?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const result = await load(async () => ({ offices: (await feesDeps().repo.listOffices()).filter((o) => !o.archived), hasLines: !!(await feesDeps().repo.getDefaultSchedule()) }));
  return (
    <>
      <PageTitle title="Import returns" back={{ href: "/fees", label: "Fees & Statements" }}>Upload a CSV exported from your tax software for one office. New returns are recorded and charged that office&apos;s current fees; a return already recorded (same reference and tax year) is updated. Rows with problems are skipped and listed.</PageTitle>
      <Flash notice={sp.notice} error={sp.error} />
      <FeesNav active="import" />
      {!result.ok ? <SetupRequired message={result.message} /> : (
        <section className="monarch-panel" style={{ padding: 20 }}>
          {!result.data.hasLines && <div className="monarch-notice"><b>SET UP YOUR FEES FIRST</b> Returns are charged when they&apos;re imported. <Link href="/fees/schedule">Set up the fee schedule</Link>.</div>}
          <FeesImport kind="returns" fields={RETURN_FIELDS} offices={result.data.offices} defaultOffice={sp.office && UUID.test(sp.office) ? sp.office : ""} defaultYear={defaultTaxYear()} />
          <p className="monarch-muted">Needed columns: a return reference (the tax software&apos;s return ID) and the taxpayer&apos;s name. Optional: tax year, bank product (matched to your list in Software &amp; banking; blank or &quot;none&quot; means no bank product), filed date, funded date. Don&apos;t include Social Security numbers.</p>
        </section>
      )}
    </>
  );
}
