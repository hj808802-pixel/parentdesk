import { adminEnabled, isAdminRequest } from "@/lib/admin";
import { loadSchools, rebuildDirectory } from "@/lib/rooms";

export const runtime = "nodejs";
export const maxDuration = 60;

// Maintenance: rebuilds the class search from the rooms and teachers themselves (the
// directory and the school list are caches). Admin only.
export async function POST(req: Request) {
  if (!adminEnabled()) return Response.json({ ok: false, error: "admin_off" }, { status: 404 });
  if (!isAdminRequest(req)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  const entries = await rebuildDirectory();
  const schools = await loadSchools(true);
  return Response.json({ ok: true, listed: entries.length, schools: schools.length, ms: Date.now() - started });
}
