import { loadRoom, loadRooms, recallPost, teacherFromRequest, teacherView } from "@/lib/rooms";

export const runtime = "nodejs";
export const maxDuration = 60;

// Recalls a sent post: it disappears from every room of the teacher that holds it and from
// the list of every family that follows those rooms.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; postId: string }> }) {
  const teacher = await teacherFromRequest(req);
  if (!teacher) return Response.json({ ok: false, error: "no_teacher" }, { status: 404 });
  const { id, postId } = await params;
  const room = await loadRoom(id);
  if (!room || room.teacherId !== teacher.id) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  if (!room.posts.some((p) => p.id === postId)) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const res = await recallPost(teacher, postId);
  console.log(JSON.stringify({ event: "room_recall", teacher: teacher.id, room: room.id, post: postId, ...res }));
  return Response.json({ ok: true, ...res, teacher: teacherView(teacher, await loadRooms(teacher)) });
}
