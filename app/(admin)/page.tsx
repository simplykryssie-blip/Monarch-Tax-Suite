import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { currentTier } from "@/lib/tier-server";
import { allows } from "@/lib/tier.ts";
import { PageTitle, SetupRequired } from "@/components/admin/ui";
import { HomeGrid } from "@/components/home/home-grid";
import { AddContact } from "@/components/contacts/add-contact";
import { contactKinds } from "@/lib/contacts/kinds.ts";
import { buildHome, type AgendaSource, type LeadLite } from "@/lib/home/model.ts";
import { appointmentDeps } from "@/lib/appointments/server";
import { addDays, atLocal, parseYmd, ymdString } from "@/lib/calendar/business.ts";
import { leadsDeps } from "@/lib/leads/server";
import { boardStages, workspaceLoad, workspaceRepo } from "@/lib/workspace/load";

const localDay = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const clock = (iso: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/**
 * Home: what to do today. One page for every plan: the numbers come from the account's own clients, returns, invoices, tasks,
 * appointments and (where the plan has Leads) leads. Each person arranges the cards to suit; see components/home/home-grid.tsx.
 */
export default async function Home() {
  const admin = await requireAdmin();
  const tier = await currentTier();

  const result = await workspaceLoad(async () => {
    const repo = workspaceRepo();
    const apptDeps = appointmentDeps();
    const cal = await apptDeps.calendar().catch(() => null);
    const tz = cal?.timeZone ?? "America/Chicago";
    const today = localDay(new Date().toISOString(), tz);
    const first = parseYmd(today)!;
    const from = atLocal(first, 0, tz);
    const to = atLocal(addDays(first, 2), 0, tz);
    const [clients, returns, invoices, tasks, stages, appts, types, leads] = await Promise.all([
      repo.listClients({ includeArchived: false }),
      repo.listReturns({}),
      repo.listInvoices({}),
      repo.listTasks({ openOnly: true }),
      boardStages(),
      apptDeps.repo.listAppointments(from, to).catch(() => []),
      apptDeps.repo.listTypes().catch(() => []),
      allows(tier, "leads") ? leadsDeps().repo.listLeads({ limit: 500 }).catch(() => null) : Promise.resolve(null),
    ]);
    const typeName = new Map(types.map((t) => [t.id, t.name]));
    const appointments: AgendaSource[] = appts.filter((a) => a.status !== "cancelled").map((a) => ({ id: a.id, day: localDay(a.starts_at, tz), time: clock(a.starts_at, tz), who: a.contact_name, title: typeName.get(a.type_id) ?? "Appointment" }));
    const leadRows: LeadLite[] | null = leads ? leads.map((l) => ({ id: l.id, full_name: l.full_name, source: l.source, status: l.status, created_at: l.created_at, last_contacted_at: l.last_contacted_at })) : null;
    // The same default year as Returns: the newest year that has returns, or last year.
    const years = [...new Set(returns.map((r) => r.tax_year))].sort((a, b) => b - a);
    const year = years[0] ?? Number(today.slice(0, 4)) - 1;
    return { tz, today, tomorrow: ymdString(addDays(first, 1)), year, clients, returns, invoices, tasks, stages, appointments, leads: leadRows };
  });

  const hour = result.ok ? Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: result.data.tz }).format(new Date())) % 24 : 12;
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageTitle title={greeting}>What needs you today. Open a card to go to its list, or press Edit layout to arrange Home your way.</PageTitle>
      <div className="hm-quick">
        <AddContact kinds={contactKinds(tier)} className="monarch-secondary" />
        <Link className="monarch-secondary" href="/workspace/work?add=1">Add return</Link>
        <Link className="monarch-primary" href="/workspace/billing?add=1">New invoice</Link>
      </div>
      {!result.ok ? <SetupRequired message={result.message} /> : (
        <HomeGrid
          storageKey={`verexa-home-layout:v1:${admin.userId}`}
          data={buildHome({ today: result.data.today, tomorrow: result.data.tomorrow, year: result.data.year, invoices: result.data.invoices, clients: result.data.clients, returns: result.data.returns, stages: result.data.stages, tasks: result.data.tasks, appointments: result.data.appointments, leads: result.data.leads })}
        />
      )}
    </>
  );
}
