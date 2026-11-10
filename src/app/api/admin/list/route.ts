import { adminEnabled, familyRow, isAdminRequest, systemChecklist } from "@/lib/admin";
import { isTeacherPaused, readAdminActions, readAnnouncement, readFamilyAdmin } from "@/lib/ops";
import { listRoomIds, listTeacherIds, loadDirectory, loadRoom, loadSchools, loadTeacher, schoolIdOf, type RoomRecord, type TeacherRecord } from "@/lib/rooms";
import { listFamilyIds, loadFamily } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ROWS = 1000;

// The console's tables: families, teachers, rooms, schools, the action log and the set-up
// checklist. Counts, settings and what teachers chose to show; no item text, no child names.
export async function GET(req: Request) {
  if (!adminEnabled()) return Response.json({ ok: false, error: "admin_off" }, { status: 404 });
  if (!(await isAdminRequest(req))) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const now = new Date();
  const month = now.toISOString().slice(0, 7);

  const families = [];
  for (const id of (await listFamilyIds()).slice(0, MAX_ROWS)) {
    const rec = await loadFamily(id);
    if (rec) families.push(familyRow(rec, now, await readFamilyAdmin(id)));
  }
  families.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  const teacherRecs: TeacherRecord[] = [];
  for (const id of (await listTeacherIds()).slice(0, MAX_ROWS)) {
    const t = await loadTeacher(id);
    if (t) teacherRecs.push(t);
  }
  const byId = new Map(teacherRecs.map((t) => [t.id, t]));
  const roomRecs: RoomRecord[] = [];
  for (const id of (await listRoomIds()).slice(0, MAX_ROWS)) {
    const r = await loadRoom(id);
    if (r) roomRecs.push(r);
  }
  const pausedTeachers = new Set<string>();
  for (const t of teacherRecs) if (await isTeacherPaused(t.id)) pausedTeachers.add(t.id);
  const teachers = teacherRecs
    .map((t) => ({ blocked: pausedTeachers.has(t.id), id: t.id, name: t.name, school: t.school, region: t.region, city: t.city, country: t.settings.country, rooms: roomRecs.filter((r) => r.teacherId === t.id).length, monthPosts: t.usage[month] ?? 0, createdAt: t.createdAt, schoolId: schoolIdOf(t) }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const rooms = roomRecs
    .map((r) => {
      const t = byId.get(r.teacherId);
      return { id: r.id, teacherId: r.teacherId, teacherName: t?.name ?? "", school: t?.school ?? "", grade: r.grade, classLabel: r.classLabel, name: r.name, members: r.members.length, posts: r.posts.length, drafts: r.drafts.length, lastPostAt: r.posts.length ? r.posts[r.posts.length - 1].ts : null, listed: r.listed, createdAt: r.createdAt, orphan: !t };
    })
    .sort((a, b) => ((a.lastPostAt ?? a.createdAt) < (b.lastPostAt ?? b.createdAt) ? 1 : -1));
  const directory = await loadDirectory(true);
  const schools = (await loadSchools(true))
    .map((s) => ({ ...s, rooms: directory.filter((e) => e.schoolId === s.id).length, teachers: teachers.filter((t) => t.schoolId === s.id).length }))
    .sort((a, b) => b.rooms - a.rooms || a.name.localeCompare(b.name));
  const log = await readAdminActions(50);
  return Response.json({ ok: true, families, teachers, rooms, schools, log, announcement: await readAnnouncement(), checklist: await systemChecklist(), abandoned: families.filter((f) => f.empty).map((f) => f.id) }, { headers: { "cache-control": "no-store" } });
}
