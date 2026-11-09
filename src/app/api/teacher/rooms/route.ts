import { allowRequest, clientIp } from "@/lib/ratelimit";
import { MAX_ROOMS_PER_TEACHER, createRoom, loadRooms, sanitizeName, saveRoom, saveTeacher, teacherFromRequest, teacherView } from "@/lib/rooms";

export const runtime = "nodejs";

// Opens a new class room for the teacher ({ name }).
export async function POST(req: Request) {
  const teacher = await teacherFromRequest(req);
  if (!teacher) return Response.json({ ok: false, error: "no_teacher" }, { status: 404 });
  const gate = allowRequest({ ip: clientIp(req), family: `t:${teacher.id}` });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason }, { status: 429 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !sanitizeName(body.name)) return Response.json({ ok: false, error: "name_required" }, { status: 400 });
  if (teacher.roomIds.length >= MAX_ROOMS_PER_TEACHER) return Response.json({ ok: false, error: "too_many_rooms" }, { status: 429 });
  const room = createRoom(teacher, body.name);
  if (!room) return Response.json({ ok: false, error: "name_required" }, { status: 400 });
  await saveRoom(room);
  await saveTeacher(teacher);
  return Response.json({ ok: true, roomId: room.id, teacher: teacherView(teacher, await loadRooms(teacher)) });
}
