// One part of a settings page: what it is and what it does on the left, the fields on the right.
export function SettingRow({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="sx-set">
      <div className="sx-set-intro">
        <h2>{title}</h2>
        {desc && <p>{desc}</p>}
      </div>
      <div className="sx-set-body">{children}</div>
    </section>
  );
}
