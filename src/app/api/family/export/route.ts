import { exportBackup } from "@/lib/backup";
import { familyFromRequest } from "@/lib/store";

export const runtime = "nodejs";

// The family's own copy of its list, as a file (children, notices, items; no keys or
// secrets). With no accounts, this file is the way back after a lost key.
export async function GET(req: Request) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(exportBackup(rec)), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="parentdesk-backup-${day}.json"`, "cache-control": "no-store" },
  });
}
