import { adminEnabled, adminOf } from "@/lib/admin";
import { recordAdminAction } from "@/lib/ops";
import { compactUsage } from "@/lib/usage";
import { loadSchools, rebuildDirectory } from "@/lib/rooms";

export const runtime = "nodejs";
export const maxDuration = 60;

// Maintenance: rebuilds the class search from the rooms and teachers themselves (the
// directory and the school list are caches) and folds finished days of model usage. Owners only.
export async function POST(req: Request) {
  if (!adminEnabled()) return Response.json({ ok: false, error: "admin_off" }, { status: 404 });
  const me = await adminOf(req);
  if (!me) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (me.role !== "owner") return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const started = Date.now();
  const entries = await rebuildDirectory();
  const schools = await loadSchools(true);
  const folded = await compactUsage(); // finished days of model usage, one document per day
  await recordAdminAction("rebuild", "-", `${entries.length} rooms, ${schools.length} schools, ${folded.calls} usage rows folded`, me.name);
  return Response.json({ ok: true, listed: entries.length, schools: schools.length, ms: Date.now() - started });
}
