import { allowRequest, clientIp } from "@/lib/ratelimit";
import { clearTeacherCookie, createTeacher, deleteRoom, deleteTeacher, loadRooms, sanitizeName, sanitizeSchool, saveTeacher, teacherCookie, teacherFromRequest, teacherView } from "@/lib/rooms";
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
  return Response.json({ ok: true, teacher: teacherView(teacher, rooms) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const existing = await teacherFromRequest(req);
  if (existing) return Response.json({ ok: true, teacher: teacherView(existing, await loadRooms(existing)) });
  const gate = allowRequest({ ip: clientIp(req), family: null });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason, retry_after: gate.retryAfterSec }, { status: 429 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  const name = sanitizeName(body.name);
  if (!name) return Response.json({ ok: false, error: "name_required" }, { status: 400 });
  const { record, key } = createTeacher({
    name,
    school: body.school,
    locale: typeof body.locale === "string" ? body.locale : null,
    timezone: typeof body.timezone === "string" ? body.timezone : null,
    settings: body.settings && typeof body.settings === "object" ? (body.settings as Record<string, unknown>) : undefined,
  });
  await saveTeacher(record);
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
  if (typeof body.school === "string") teacher.school = sanitizeSchool(body.school);
  if (body.settings) teacher.settings = sanitizeSettings(body.settings, teacher.settings);
  await saveTeacher(teacher);
  return Response.json({ ok: true, teacher: teacherView(teacher, await loadRooms(teacher)) });
}

export async function DELETE(req: Request) {
  const teacher = await teacherFromRequest(req);
  if (teacher) {
    for (const room of await loadRooms(teacher)) await deleteRoom(room.id);
    await deleteTeacher(teacher.id);
  }
  return Response.json({ ok: true }, { headers: { "set-cookie": clearTeacherCookie(isHttps(req)) } });
}
