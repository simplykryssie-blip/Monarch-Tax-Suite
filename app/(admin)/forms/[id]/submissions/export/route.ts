import { requireAdmin } from "@/lib/admin";
import { formDeps } from "@/lib/forms/server";
import { exportCsv } from "@/lib/forms/service.ts";

// Every submission of a form as CSV, for an administrator. Identifiers stay masked and uploads are left out; the
// export is recorded in the form's history.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const { csv, fileName } = await exportCsv(formDeps(), id, admin.userId);
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
