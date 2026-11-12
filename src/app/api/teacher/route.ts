import { teacherPause } from "@/lib/ops";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { clearTeacherCookie, createTeacher, deleteRoom, deleteTeacher, forgetSchoolIfUnused, loadRooms, rememberSchool, removeFromDirectory, sanitizeName, sanitizePlace, sanitizeSchool, saveTeacher, schoolIdOf, syncDirectory, teacherCookie, teacherFromRequest, teacherView } from "@/lib/rooms";
import { isHttps, sanitizeSettings } from "@/lib/store";

export const runtime = "nodejs";

// The teacher document behind the pd_teacher cookie (lib/rooms.ts).
// GET: the teacher and their rooms. POST: create one and set the cookie. PATCH: name and
// settings. DELETE: remove the teacher and every room, and clear the cookie. Families keep
// the items a room already delivered.

export async function GET(req: Request) {
  const teacher = await teacherFromRequest(req);
  if (!teacher) return Response.json({ ok: false, error: "no_teacher" }, { status: 404 });
  const rooms = await loadRooms(teacher);
  const pause = await teacherPause(teacher.id);
  return Response.json({ ok: true, teacher: teacherView(teacher, rooms), paused: pause.blocked ? { reason: pause.reason } : null }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const existing = await teacherFromRequest(req);
  if (existing) return Response.json({ ok: true, teacher: teacherView(existing, await loadRooms(existing)) });
  const gate = await allowRequest({ ip: clientIp(req), family: null });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason, retry_after: gate.retryAfterSec }, { status: 429 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  const name = sanitizeName(body.name);
  if (!name) return Response.json({ ok: false, error: "name_required" }, { status: 400 });
  const { record, key } = createTeacher({
    name,
    school: body.school,
    region: body.region,
    city: body.city,
    locale: typeof body.locale === "string" ? body.locale : null,
    timezone: typeof body.timezone === "string" ? body.timezone : null,
    settings: body.settings && typeof body.settings === "object" ? (body.settings as Record<string, unknown>) : undefined,
  });
  await saveTeacher(record);
  if (record.school) await rememberSchool(record);
  return Response.json({ ok: true, teacher: teacherView(record, []), key }, { headers: { "set-cookie": teacherCookie(key, isHttps(req)) } });
}

export async function PATCH(req: Request) {
  const teacher = await teacherFromRequest(req);
  if (!teacher) return Response.json({ ok: false, error: "no_teacher" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  if (typeof body.name === "string") {
    const name = sanitizeName(body.name);
    if (!name) return Response.json({ ok: false, error: "name_required" }, { status: 400 });
    teacher.name = name;
  }
  const before = schoolIdOf(teacher);
  if (typeof body.school === "string") teacher.school = sanitizeSchool(body.school);
  if (typeof body.region === "string") teacher.region = sanitizePlace(body.region);
  if (typeof body.city === "string") teacher.city = sanitizePlace(body.city);
  if (body.settings) teacher.settings = sanitizeSettings(body.settings, teacher.settings);
  await saveTeacher(teacher);
  // The directory shows the school, the teacher's name and country: keep it in step, and
  // the school list follows the school the teacher now names.
  const rooms = await loadRooms(teacher);
  if (rooms.some((r) => r.listed)) await syncDirectory(teacher, rooms);
  const after = schoolIdOf(teacher);
  if (after) await rememberSchool(teacher);
  if (before && before !== after) await forgetSchoolIfUnused(before);
  return Response.json({ ok: true, teacher: teacherView(teacher, rooms) });
}

export async function DELETE(req: Request) {
  const teacher = await teacherFromRequest(req);
  if (teacher) {
    const rooms = await loadRooms(teacher);
    for (const room of rooms) await deleteRoom(room.id);
    await deleteTeacher(teacher.id);
    await removeFromDirectory(rooms.map((r) => r.id));
    await forgetSchoolIfUnused(schoolIdOf(teacher));
  }
  return Response.json({ ok: true }, { headers: { "set-cookie": clearTeacherCookie(isHttps(req)) } });
}
