import { applyTally, loadRoom, saveRoom, type RoomRecord } from "@/lib/rooms";
import { applyItemPatch, familyFromRequest, saveFamily, toView } from "@/lib/store";

export const runtime = "nodejs";

const STATUSES = ["open", "done", "dismissed"] as const;
const MAX_IDS = 200;

// Several items at once: { ids, status }. Used by the home screen to clear past-due items
// in one tap. Items a class room delivered report their new status to the room's tallies.
export async function POST(req: Request) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !Array.isArray(body.ids)) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  const status = String(body.status) as (typeof STATUSES)[number];
  if (!(STATUSES as readonly string[]).includes(status)) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  const ids = new Set(body.ids.filter((x): x is string => typeof x === "string").slice(0, MAX_IDS));

  const rooms = new Map<string, RoomRecord>();
  let changed = 0;
  for (let i = 0; i < rec.items.length; i++) {
    const before = rec.items[i];
    if (!ids.has(before.id) || before.status === status) continue;
    rec.items[i] = applyItemPatch(before, { status });
    changed++;
    if (before.roomItemIndex == null) continue;
    const source = rec.sources.find((s) => s.id === before.sourceId);
    if (!source?.roomId || !source.postId) continue;
    try {
      const room = rooms.get(source.roomId) ?? (await loadRoom(source.roomId));
      const post = room?.posts.find((p) => p.id === source.postId);
      if (room && post) {
        rooms.set(room.id, room);
        applyTally(post, before.roomItemIndex, before.status, status);
      }
    } catch (e) {
      console.warn("[items bulk] tally not updated", e instanceof Error ? e.message : e);
    }
  }
  if (changed) await saveFamily(rec);
  for (const room of rooms.values()) await saveRoom(room).catch((e) => console.warn("[items bulk] room not saved", e instanceof Error ? e.message : e));
  return Response.json({ ok: true, changed, family: toView(rec) });
}
