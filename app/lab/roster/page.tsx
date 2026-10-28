import { redirect } from "next/navigation";
import { InviteForm, ReissueButton } from "@/components/lab/roster-forms";
import { labRepo, requireLab } from "@/lib/lab/server";
import { seatsUsed } from "@/lib/lab/service";
import { removeStudentAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Students" };

export default async function RosterPage({ searchParams }: { searchParams?: Promise<{ notice?: string; error?: string }> }) {
  const ctx = await requireLab("/lab/roster");
  const ms = ctx.membership;
  if (ms?.member.role !== "instructor") redirect("/lab");
  const sp = await searchParams;
  const members = (await labRepo().membersOfLicense(ms.member.license_id)).filter((m) => m.role === "student" && m.status !== "removed");
  const open = ms.terms.seats - seatsUsed(members);
  return (
    <div className="lab-wrap"><main className="lab-main lab-stack">
      <div className="lab-stack" style={{ gap: 6 }}>
        <span className="lab-eyebrow">Your class</span>
        <h1>Students</h1>
        <p className="lab-muted">{seatsUsed(members)} of {ms.terms.seats} seats used. Invited students hold a seat until you remove them.</p>
      </div>
      {sp?.notice ? <div className="lab-notice good">{sp.notice}</div> : null}
      {sp?.error ? <div className="lab-notice bad">{sp.error}</div> : null}
      <div className="lab-card lab-stack">
        <h2>Invite students</h2>
        <InviteForm open={open} />
      </div>
      <div className="lab-card lab-stack">
        <h2>Roster</h2>
        {members.length === 0 ? <p className="lab-muted">No students yet. Invite them above.</p> : (
          <div className="lab-scroll"><table className="lab-table">
            <thead><tr><th>Student</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td><b>{m.display_name || m.email}</b>{m.display_name ? <><br /><span className="lab-muted lab-small">{m.email}</span></> : null}</td>
                  <td>{m.status === "active" ? <span className="lab-pill good">Joined</span> : <span className="lab-pill warn">Invited</span>}</td>
                  <td>
                    <div className="lab-row" style={{ justifyContent: "flex-end", alignItems: "flex-start" }}>
                      {m.status === "invited" ? <ReissueButton memberId={m.id} /> : null}
                      <form action={removeStudentAction}><input type="hidden" name="member_id" value={m.id} /><button type="submit" className="lab-btn sm danger">Remove</button></form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </main></div>
  );
}
