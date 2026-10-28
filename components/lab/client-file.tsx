import { practiceForms, type PracticeForm } from "@/lib/lab/documents";
import type { Fact, SourceDocs } from "@/lib/lab/types";

// The client file: interview notes (when the scenario provides them), the household roster and practice copies of the
// documents the client brought. No answer-key data reaches this component.

export function PracticeFormView({ form }: { form: PracticeForm }) {
  return (
    <div className="lab-form">
      <div className="fh"><b>{form.title}</b><span>{form.subtitle}</span><em>Practice copy</em></div>
      <div className="fg">
        {form.boxes.map((b, i) => (
          <div key={i} className={`bx${b.wide ? " wide" : ""}`}>
            <span>{b.label}</span>
            <span className={b.wide ? "txt" : "amt"}>{b.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Paragraphs({ text }: { text: string }) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return <p className="lab-muted">No interview notes for this scenario.</p>;
  return <div className="lab-narr">{paras.map((p, i) => <p key={i} style={{ whiteSpace: "pre-line" }}>{p}</p>)}</div>;
}

export function ClientFile({ narrative, facts, documents, interview }: { narrative: string | null; facts: Fact[] | null; documents: SourceDocs; interview: boolean }) {
  const forms = practiceForms(documents);
  return (
    <div className="lab-stack">
      {narrative !== null ? (
        <div className="lab-card lab-stack"><h3>Client interview notes</h3><Paragraphs text={narrative} /></div>
      ) : (
        <div className="lab-card lab-stack">
          <h2>Interview the client</h2>
          <p className="lab-muted">The client’s story isn’t written down for this scenario. Your instructor will play the client: ask your questions, record what you learn on the Intake sheet tab, then prepare the return.</p>
        </div>
      )}
      {facts && facts.length ? (
        <div className="lab-card lab-stack"><h3>Key facts</h3><dl className="lab-facts">{facts.map((f, i) => <div key={i} style={{ display: "contents" }}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl></div>
      ) : null}
      {documents.household?.length ? (
        <div className="lab-card lab-stack">
          <h3>Household roster</h3>
          <dl className="lab-facts">{documents.household.map((p, i) => <div key={i} style={{ display: "contents" }}><dt>{p.role}</dt><dd>{p.name || "—"}{p.info ? <span className="lab-muted"> · {p.info}</span> : null}</dd></div>)}</dl>
        </div>
      ) : null}
      {forms.length ? <><h3>Documents the client brought</h3><div className="lab-stack">{forms.map((f, i) => <PracticeFormView key={i} form={f} />)}</div></> : null}
      {!forms.length && !documents.household?.length && interview ? <p className="lab-muted lab-small">No documents are attached; collect what you need in the interview.</p> : null}
    </div>
  );
}
