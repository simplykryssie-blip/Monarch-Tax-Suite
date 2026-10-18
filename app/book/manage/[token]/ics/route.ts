import { bookingContext } from "@/lib/appointments/public";
import { appointmentIcs } from "@/lib/appointments/messages.ts";
import { lookupByToken } from "@/lib/appointments/service.ts";

/** The appointment as a calendar file. The link's token is the credential. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { deps } = await bookingContext();
  const found = await lookupByToken(deps, token);
  if (!found || found.a.status !== "booked") return new Response("Not found", { status: 404 });
  const firm = await deps.firmName().catch(() => "Our office");
  const body = appointmentIcs(found.a, found.t, firm, new URL(request.url).host);
  return new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="appointment.ics"', "cache-control": "private, no-store" } });
}
