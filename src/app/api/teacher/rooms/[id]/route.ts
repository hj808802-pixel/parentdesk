import { deleteRoom, loadRoom, loadRooms, rotateJoinSecret, sanitizeDescription, sanitizeName, saveRoom, saveTeacher, teacherFromRequest, teacherView } from "@/lib/rooms";

export const runtime = "nodejs";

// One of the teacher's rooms. PATCH: { name } renames it, { description } sets the note parents
// see when they join, { rotate: true } makes a new join link (the old one stops working;
// families already following stay). DELETE: closes it.

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const teacher = await teacherFromRequest(req);
  if (!teacher) return Response.json({ ok: false, error: "no_teacher" }, { status: 404 });
  const { id } = await params;
  const room = await loadRoom(id);
  if (!room || room.teacherId !== teacher.id) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  if (typeof body.name === "string") {
    const name = sanitizeName(body.name);
    if (!name) return Response.json({ ok: false, error: "name_required" }, { status: 400 });
    room.name = name;
  }
  if (typeof body.description === "string") room.description = sanitizeDescription(body.description);
  if (body.rotate === true) rotateJoinSecret(room);
  await saveRoom(room);
  return Response.json({ ok: true, teacher: teacherView(teacher, await loadRooms(teacher)) });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const teacher = await teacherFromRequest(req);
  if (!teacher) return Response.json({ ok: false, error: "no_teacher" }, { status: 404 });
  const { id } = await params;
  const room = await loadRoom(id);
  if (!room || room.teacherId !== teacher.id) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  await deleteRoom(room.id);
  teacher.roomIds = teacher.roomIds.filter((r) => r !== room.id);
  await saveTeacher(teacher);
  return Response.json({ ok: true, teacher: teacherView(teacher, await loadRooms(teacher)) });
}
