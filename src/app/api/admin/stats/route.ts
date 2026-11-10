import { adminEnabled, adminOf, adminUsers, computeStats, daysBack, familySummary } from "@/lib/admin";
import { readUsage } from "@/lib/usage";
import { listRoomIds, listTeacherIds, loadDirectory, loadRoom, loadSchools, loadTeacher, roomStats, type RoomRecord } from "@/lib/rooms";
import { features, listFamilyIds, loadFamily, readOps, storageMode, type FamilyRecord } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// Operator numbers, computed by walking the family documents. ?family=<id> returns one
// family's summary instead (no item text, no child names).

const MAX_FAMILIES = 3000;

export async function GET(req: Request) {
  if (!adminEnabled()) return Response.json({ ok: false, error: "admin_off" }, { status: 404 });
  const me = adminOf(req);
  if (!me) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

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
  // Teacher sign-ups per day and this month's posts, over every teacher.
  const month = new Date().toISOString().slice(0, 7);
  const created: string[] = [];
  let teacherPosts = 0;
  for (const id of teacherIds) {
    const t = await loadTeacher(id);
    if (!t) continue;
    created.push(t.createdAt.slice(0, 10));
    teacherPosts += t.usage[month] ?? 0;
  }
  const teacherSignups = daysBack(30).map((day) => ({ day, n: created.filter((d) => d === day).length }));
  // The class search: what the rooms say, and what the directory and the school list hold
  // (they should agree; "rebuild" puts them back in step).
  const [directory, schools] = await Promise.all([loadDirectory(true), loadSchools(true)]);
  const search = { listedRooms: rooms.filter((r) => r.listed).length, directoryEntries: directory.length, schools: schools.length };
  const runs = (await readOps<Record<string, unknown>>("runs")) ?? {};
  return Response.json(
    {
      ok: true,
      stats,
      rooms: roomNumbers,
      search,
      teacherSignups,
      teacherPosts,
      me,
      admins: adminUsers().map((u) => ({ name: u.name, role: u.role, twoStep: u.totp !== null })),
      usage: await readUsage(month),
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
