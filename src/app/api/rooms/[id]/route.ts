import { loadRoom, sanitizeChildIds, saveRoom, unsubscribe } from "@/lib/rooms";
import { familyFromRequest, saveFamily, toView } from "@/lib/store";

export const runtime = "nodejs";

// A room this family follows. PATCH { childIds }: which children its posts are tagged with.
// DELETE: stop following (items already on the list stay).

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  const { id } = await params;
  const sub = (rec.rooms ?? []).find((s) => s.roomId === id);
  if (!sub) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  if ("childIds" in body) sub.childIds = sanitizeChildIds(body.childIds, rec);
  await saveFamily(rec);
  return Response.json({ ok: true, family: toView(rec) });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  const { id } = await params;
  if (!(rec.rooms ?? []).some((s) => s.roomId === id)) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const room = await loadRoom(id);
  unsubscribe(rec, room, id);
  await saveFamily(rec);
  if (room) await saveRoom(room);
  return Response.json({ ok: true, family: toView(rec) });
}
