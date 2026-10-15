import { notFound } from "next/navigation";
import { tenantDb } from "@/lib/admin";
import { Badge, Flash, PageTitle } from "@/components/admin/ui";
import { SmsEditor } from "@/components/admin/sms-editor";
import { SMS_VARIABLES } from "@/lib/automation/sms.ts";
import { SupabaseSmsRepo } from "@/lib/automation/sms-repo";
import { saveSmsAction, smsActiveAction } from "../../../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SmsTemplatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { id } = await params;
  const { notice, error } = await searchParams;
  const isNew = id === "new";
  if (!isNew && !UUID.test(id)) notFound();
  const t = isNew ? null : await new SupabaseSmsRepo(tenantDb()).get(id).catch(() => null);
  if (!isNew && !t) notFound();
  return (
    <>
      <PageTitle title={t ? t.name : "New text template"} back={{ href: "/automation/templates", label: "Templates" }}>{t ? <>Status: <Badge value={t.active ? "active" : "inactive"} /></> : "Short plain text. Placeholders are filled in when it is sent."}</PageTitle>
      <Flash notice={notice} error={error} />
      <div className="monarch-notice"><b>SAVED FOR LATER</b> Text messaging is not connected yet, so no workflow can send a text. Templates saved here will be ready.</div>
      <form action={saveSmsAction} className="monarch-panel monarch-form" style={{ padding: 20 }}>
        {t && <input type="hidden" name="id" value={t.id} />}
        <label>Name<input name="name" required maxLength={120} defaultValue={t?.name} /></label>
        <div className="is-wide"><SmsEditor name="body" initial={t?.body ?? ""} placeholders={Object.entries(SMS_VARIABLES).map(([name, note]) => ({ name, note }))} /></div>
        <div className="is-wide"><button className="monarch-primary">Save text template</button></div>
      </form>
      {t && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <form action={smsActiveAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="active" value={t.active ? "no" : "yes"} /><button className="monarch-secondary">{t.active ? "Turn off" : "Turn on"}</button></form>
        </section>
      )}
    </>
  );
}
