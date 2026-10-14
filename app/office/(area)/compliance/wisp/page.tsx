import { Flash } from "@/components/admin/ui";
import { ActionForm } from "@/app/(admin)/efin/action-form";
import { VaultUpload } from "@/components/office/vault-upload";
import { attestationStatement, lastAnswers } from "@/lib/compliance/service.ts";
import { longDate, reviewState, settingsOf, todayIso } from "@/lib/compliance/rules.ts";
import { BUILDER_FIELDS, BUILDER_STEPS } from "@/lib/wisp/content.ts";
import { attestAction, buildWispAction } from "../actions";
import { ComplianceTabs, compliancePage, loadOr, Required, SetupNotice, stamp } from "../parts";

/**
 * The office's WISP: build it with the shared engine (or upload your own), attest to it once for the firm, and see
 * who on the team has acknowledged it.
 */
export default async function WispPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; built?: string; uploaded?: string; edit?: string }> }) {
  const { ctx, deps, may } = await compliancePage("compliance.home");
  const sp = await searchParams;
  const manage = may("compliance.manage");
  const result = await loadOr(async () => {
    const [attestations, docs, team, settings] = await Promise.all([
      deps.repo.listAttestations(ctx.officeId), deps.repo.listDocuments(ctx.officeId, { kind: "wisp" }), deps.repo.listTeam(ctx.officeId), deps.repo.getSettings(ctx.officeId),
    ]);
    const latest = attestations[0] ?? null;
    const acks = latest ? await deps.repo.listAcks(latest.id) : [];
    const answers = manage ? await lastAnswers(deps, ctx.officeId) : null;
    return { attestations, latest, docs, team: team.filter((m) => m.status === "active"), acks, settings: settingsOf(settings), answers };
  });
  if (!result.ok) return <><h1 className="office-h1">WISP</h1><SetupNotice message={result.message} /></>;
  const { latest, docs, team, acks, settings, answers, attestations } = result.data;
  const review = reviewState(latest, todayIso(), settings.review_reminder_days);
  const chosen = sp.built ?? sp.uploaded ?? latest?.document_id ?? docs[0]?.id ?? "";
  const doc = (id: string | null) => docs.find((d) => d.id === id);
  const showBuilder = manage && (!latest || sp.edit === "1" || !docs.length);
  return (
    <>
      <h1 className="office-h1">Written Information Security Plan</h1>
      <ComplianceTabs may={may} active="/office/compliance/wisp" />
      <Flash notice={sp.notice} error={sp.error} />

      <section className="monarch-panel" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Status</h2>
        <p><Required by="IRS" /> IRS Publication 5708 and the FTC Safeguards Rule require a written information security plan, reviewed at least once a year.</p>
        {!latest ? <p className="monarch-alert">No attestation yet. {manage ? "Build your WISP below (or upload the one you have), then attest." : "Your ERO will attest the office's WISP."}</p> : (
          <div className="monarch-metrics">
            <div className="monarch-metric"><div>Attested by</div><strong>{latest.attested_name}</strong><small>{stamp(latest.attested_at)}</small></div>
            <div className="monarch-metric"><div>Next review</div><strong className={review.state === "overdue" ? "is-danger" : undefined}>{review.state === "overdue" ? "Overdue" : longDate(latest.review_due)}</strong><small>{review.state === "overdue" ? `Was due ${longDate(latest.review_due)}` : `${review.days} days`}</small></div>
            <div className="monarch-metric"><div>Acknowledged</div><strong>{team.filter((m) => acks.some((a) => a.member_id === m.id)).length} of {team.length}</strong><small>team members</small></div>
          </div>
        )}
        {latest && doc(latest.document_id) && <p><a className="monarch-secondary" href={`/office/compliance/vault/download/${latest.document_id}`}>Read the current WISP</a></p>}
        {latest && !latest.document_id && <p className="monarch-muted">The file this attestation was made on has been removed from the vault. The attestation itself is kept.</p>}
      </section>

      {latest && (
        <section className="monarch-panel">
          <div className="monarch-panel-head"><div><h2>Acknowledgments</h2><p>Each PTIN holder confirms they&apos;ve read the office WISP. A new attestation asks everyone again.</p></div></div>
          <div className="monarch-table-wrap"><table>
            <thead><tr><th>TEAM MEMBER</th><th>ROLE</th><th>ACKNOWLEDGED</th></tr></thead>
            <tbody>{team.map((m) => { const a = acks.find((x) => x.member_id === m.id); return <tr key={m.id}><td><b>{m.full_name}</b></td><td>{m.role === "ero" ? "ERO" : "Preparer"}</td><td>{a ? stamp(a.acknowledged_at) : <span className="monarch-muted">Not yet</span>}</td></tr>; })}</tbody>
          </table></div>
        </section>
      )}

      {manage && ctx.role !== "bureau" && docs.length > 0 && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>{latest ? "Review and attest again" : "Attest your WISP"}</h2>
          <p className="monarch-muted">Attest once for the whole firm. The next review is due {settings.review_months} months after you attest (change this in Settings).</p>
          <ActionForm action={attestAction} className="monarch-form compliance-form">
            <label className="is-wide">WISP
              <select name="document_id" defaultValue={chosen} required>
                {docs.map((d) => <option key={d.id} value={d.id}>{d.title} · {d.answers_sealed ? "built here" : "uploaded"} · {stamp(d.created_at)}</option>)}
              </select>
            </label>
            <p className="is-wide compliance-statement">{attestationStatement(ctx.officeName)}</p>
            <label className="monarch-check is-wide"><input type="checkbox" name="confirm" value="yes" required /> I confirm this statement.</label>
            <label>Your full name (signature) *<input name="name" required maxLength={200} defaultValue={ctx.name} autoComplete="name" /></label>
            <div className="is-wide"><button className="monarch-primary">Attest</button></div>
          </ActionForm>
        </section>
      )}
      {manage && ctx.role === "bureau" && <p className="monarch-alert">The office&apos;s ERO attests to its WISP. As the bureau you can see the status here.</p>}

      {manage && (
        <section className="monarch-panel" style={{ padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Build or update your WISP</h2>
          {!showBuilder ? (
            <p><a className="monarch-secondary" href="/office/compliance/wisp?edit=1">Open the builder</a> <span className="monarch-muted">Answers from your last build are filled in.</span></p>
          ) : (
            <ActionForm action={buildWispAction} className="monarch-form compliance-form">
              {BUILDER_STEPS.filter((s) => s.id !== "review").map((s) => (
                <fieldset key={s.id} className="is-wide compliance-fieldset">
                  <legend>{s.title} <small>{s.sub}</small></legend>
                  {BUILDER_FIELDS[s.id as keyof typeof BUILDER_FIELDS].map((f) => (
                    <label key={f.id} className={f.type === "textarea" ? "is-wide" : undefined}>{f.label}{f.required ? " *" : ""}
                      {f.type === "textarea" ? <textarea name={f.id} rows={3} maxLength={4000} required={f.required} placeholder={f.placeholder} defaultValue={answers?.[f.id] ?? (f.id === "firm_name" ? ctx.officeName : "")} />
                        : f.type === "select" ? <select name={f.id} required={f.required} defaultValue={answers?.[f.id] ?? ""}><option value="" disabled>Choose…</option>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>
                        : <input name={f.id} maxLength={200} required={f.required} placeholder={f.placeholder} inputMode={f.type === "number" ? "numeric" : undefined} defaultValue={answers?.[f.id] ?? (f.id === "firm_name" ? ctx.officeName : "")} />}
                    </label>
                  ))}
                </fieldset>
              ))}
              <p className="is-wide monarch-muted">Your answers are kept encrypted so next year&apos;s review starts from them. The plan is general guidance, not legal advice; consider having an attorney review it.</p>
              <div className="is-wide"><button className="monarch-primary">Build my WISP</button></div>
            </ActionForm>
          )}
          {may("compliance.vault") && (
            <>
              <h3>Or upload the WISP you already have</h3>
              <VaultUpload kind="wisp" label="Upload WISP" returnTo="/office/compliance/wisp" />
            </>
          )}
        </section>
      )}

      {attestations.length > 1 && (
        <section className="monarch-panel">
          <div className="monarch-panel-head"><div><h2>Earlier attestations</h2></div></div>
          <ul className="fees-history">{attestations.slice(1).map((a) => <li key={a.id}><b>{a.attested_name}</b> · {stamp(a.attested_at)} · review was due {longDate(a.review_due)}</li>)}</ul>
        </section>
      )}
    </>
  );
}
