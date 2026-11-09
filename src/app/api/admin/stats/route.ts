import { adminEnabled, computeStats, familySummary, isAdminRequest } from "@/lib/admin";
import { listRoomIds, listTeacherIds, loadRoom, roomStats, type RoomRecord } from "@/lib/rooms";
import { features, listFamilyIds, loadFamily, readOps, storageMode, type FamilyRecord } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// Operator numbers, computed by walking the family documents. ?family=<id> returns one
// family's summary instead (no item text, no child names).

const MAX_FAMILIES = 3000;

export async function GET(req: Request) {
  if (!adminEnabled()) return Response.json({ ok: false, error: "admin_off" }, { status: 404 });
  if (!isAdminRequest(req)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const familyId = new URL(req.url).searchParams.get("family");
  if (familyId) {
    const rec = await loadFamily(familyId.trim());
    if (!rec) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    return Response.json({ ok: true, family: familySummary(rec) }, { headers: { "cache-control": "no-store" } });
  }

  const started = Date.now();
  const ids = await listFamilyIds();
  const records: FamilyRecord[] = [];
  for (const id of ids.slice(0, MAX_FAMILIES)) {
    const rec = await loadFamily(id);
    if (rec) records.push(rec);
  }
  const stats = computeStats(records, new Date(), ids.length > MAX_FAMILIES);
  const teacherIds = await listTeacherIds();
  const roomIds = await listRoomIds();
  const rooms: RoomRecord[] = [];
  for (const id of roomIds.slice(0, MAX_FAMILIES)) {
    const room = await loadRoom(id);
    if (room) rooms.push(room);
  }
  const roomNumbers = roomStats(teacherIds.length, rooms);
  const runs = (await readOps<Record<string, unknown>>("runs")) ?? {};
  return Response.json(
    {
      ok: true,
      stats,
      rooms: roomNumbers,
      runs,
      server: {
        storage: storageMode(),
        features: features(),
        extractModel: process.env.EXTRACT_MODEL || "claude-opus-5-5",
        assistModel: process.env.ASSIST_MODEL || "claude-sonnet-5-5",
        classifyModel: process.env.CLASSIFY_MODEL || "claude-haiku-5-5",
        dailyCap: Number(process.env.DAILY_CAP ?? 500),
      },
      ms: Date.now() - started,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
