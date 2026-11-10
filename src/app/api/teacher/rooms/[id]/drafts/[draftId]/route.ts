import { dropItems, loadRoom, loadRooms, saveRoom, sendPost, takeDraft, teacherFromRequest, teacherView, type RoomRecord } from "@/lib/rooms";
import { isTeacherPaused } from "@/lib/ops";

export const runtime = "nodejs";
export const maxDuration = 60;

// A draft the teacher has checked. POST { drop: number[], targets: string[] } sends it,
// without the unticked items, to this room and to the teacher's other rooms listed in
// targets (one delivery per family). DELETE discards it.

async function own(req: Request, params: Promise<{ id: string; draftId: string }>) {
  const teacher = await teacherFromRequest(req);
  if (!teacher) return { error: Response.json({ ok: false, error: "no_teacher" }, { status: 404 }) };
  if (await isTeacherPaused(teacher.id)) return { error: Response.json({ ok: false, error: "blocked" }, { status: 403 }) };
  const { id, draftId } = await params;
  const room = await loadRoom(id);
  if (!room || room.teacherId !== teacher.id) return { error: Response.json({ ok: false, error: "not_found" }, { status: 404 }) };
  return { teacher, room, draftId };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; draftId: string }> }) {
  const got = await own(req, params);
  if ("error" in got) return got.error;
  const { teacher, room, draftId } = got;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const draft = room.drafts.find((d) => d.id === draftId);
  if (!draft) return Response.json({ ok: false, error: "draft_not_found" }, { status: 404 });
  const post = dropItems(draft, body.drop);
  if (post.items.length === 0) return Response.json({ ok: false, error: "no_items" }, { status: 400 });

  const wanted = Array.isArray(body.targets) ? body.targets.filter((x): x is string => typeof x === "string" && x !== room.id) : [];
  const targets: RoomRecord[] = [];
  for (const tid of [...new Set(wanted)].slice(0, 10)) {
    const other = await loadRoom(tid);
    if (other && other.teacherId === teacher.id) targets.push(other);
  }

  takeDraft(room, draftId);
  const started = Date.now();
  const sent = await sendPost(teacher, [room, ...targets], post);
  console.log(JSON.stringify({ event: "room_send", teacher: teacher.id, room: room.id, targets: targets.map((r) => r.id), items: post.items.length, dropped: draft.items.length - post.items.length, members: sent.members, delivered: sent.delivered, items_delivered: sent.items, languages: sent.languages, ms: Date.now() - started }));
  return Response.json({ ok: true, post, delivered: sent.delivered, members: sent.members, languages: sent.languages, teacher: teacherView(teacher, await loadRooms(teacher)) });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; draftId: string }> }) {
  const got = await own(req, params);
  if ("error" in got) return got.error;
  const { teacher, room, draftId } = got;
  if (!takeDraft(room, draftId)) return Response.json({ ok: false, error: "draft_not_found" }, { status: 404 });
  await saveRoom(room);
  return Response.json({ ok: true, teacher: teacherView(teacher, await loadRooms(teacher)) });
}
