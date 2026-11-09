import { applyTally, loadRoom, saveRoom } from "@/lib/rooms";
import { applyItemPatch, familyFromRequest, saveFamily } from "@/lib/store";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  const { id } = await params;
  const idx = rec.items.findIndex((it) => it.id === id);
  if (idx < 0) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const patch = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!patch) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  const validChild = new Set(rec.children.map((c) => c.id));
  if (Array.isArray(patch.childIds)) patch.childIds = patch.childIds.filter((c) => typeof c === "string" && validChild.has(c));
  const before = rec.items[idx];
  rec.items[idx] = applyItemPatch(before, patch);
  await saveFamily(rec);
  // An item a class room delivered: tell the room's post how many families ticked it off
  // (counts only, never who). Best effort; the parent's change is already saved.
  if (rec.items[idx].status !== before.status && before.roomItemIndex != null) {
    const source = rec.sources.find((s) => s.id === before.sourceId);
    if (source?.roomId && source.postId) {
      try {
        const room = await loadRoom(source.roomId);
        const post = room?.posts.find((p) => p.id === source.postId);
        if (room && post) {
          applyTally(post, before.roomItemIndex, before.status, rec.items[idx].status);
          await saveRoom(room);
        }
      } catch (e) {
        console.warn("[items] tally not updated", e instanceof Error ? e.message : e);
      }
    }
  }
  return Response.json({ ok: true, item: rec.items[idx] });
}

export async function DELETE(req: Request, { params }: Params) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  const { id } = await params;
  const before = rec.items.length;
  rec.items = rec.items.filter((it) => it.id !== id);
  if (rec.items.length === before) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  await saveFamily(rec);
  return Response.json({ ok: true });
}
