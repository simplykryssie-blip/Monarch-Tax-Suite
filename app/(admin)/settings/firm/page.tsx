import { FormattedInput } from "@/components/forms/formatted-input";
import { requireAdmin } from "@/lib/admin";
import { documentDeps } from "@/lib/documents/server";
import { Flash, load, PageTitle, SetupRequired, when } from "@/components/admin/ui";
import { saveFirmProfileAction } from "../actions";
import { BusinessHoursSection } from "./business-hours-section";

const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "America/Puerto_Rico", "UTC"];

export default async function FirmProfilePage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireAdmin();
  const { notice, error } = await searchParams;
  const result = await load(() => documentDeps().repo.getProfile());
  const p = result.ok ? result.data : null;
  return (
    <>
      <PageTitle title="Firm profile">Your firm&apos;s details. Document merge fields ({"{{firm_name}}"}, {"{{firm_phone}}"} …) and the emails clients receive use them.</PageTitle>
      <Flash notice={notice} error={error} />
      {!result.ok ? <SetupRequired message={result.message} /> : (
        <form action={saveFirmProfileAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
          <label>Legal name<input name="legal_name" required maxLength={200} defaultValue={p?.legal_name ?? ""} /></label>
          <label>Name clients see<input name="display_name" required maxLength={120} defaultValue={p?.display_name ?? ""} /></label>
          <label>Email<input name="email" type="email" maxLength={254} defaultValue={p?.email ?? ""} /></label>
          <label>Phone<FormattedInput kind="phone" name="phone" defaultValue={p?.phone ?? ""} /></label>
          <label>PTIN<FormattedInput kind="ptin" name="ptin" placeholder="P01234567" defaultValue={p?.ptin ?? ""} /></label>
          <label>CAF number<FormattedInput kind="caf" name="caf_number" placeholder="1234-56789" defaultValue={p?.caf_number ?? ""} /></label>
          <label className="is-wide">Mailing address<textarea name="address" rows={3} maxLength={400} defaultValue={p?.address ?? ""} /></label>
          <label>Time zone
            <select name="time_zone" defaultValue={p?.time_zone ?? "America/New_York"}>
              {[...new Set([p?.time_zone ?? "America/New_York", ...ZONES])].map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </select>
          </label>
          <div className="is-wide"><button className="monarch-primary">Save firm profile</button>{p && <small className="monarch-muted"> Last saved {when(p.updated_at)}</small>}</div>
        </form>
      )}
      <BusinessHoursSection />
    </>
  );
}
