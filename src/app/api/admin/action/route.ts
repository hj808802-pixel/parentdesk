import { adminEnabled, hasLiveSubscription, isAbandoned, isAdminRequest } from "@/lib/admin";
import { recordAdminAction } from "@/lib/ops";
import { deleteRoom, deleteTeacher, forgetSchoolIfUnused, loadRoom, loadRooms, loadTeacher, removeFromDirectory, saveRoom, saveTeacher, schoolIdOf, syncDirectory } from "@/lib/rooms";
import { deleteFamily, loadFamily, saveFamily } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// What the operator can do from the console. Every action is logged (what, which id).
// POST { action, id }:
//   family_delete      removes one family and everything on it (refused while Stripe still bills it)
//   family_reset_usage clears this month's notice count (support: "I hit the limit by mistake")
//   families_purge     removes the families named in { ids } that are still unused and a month old
//   room_unlist        takes a room out of the class search (it stays, link and code work)
//   room_delete        closes a room; families keep what was already delivered
//   teacher_delete     removes a teacher desk and its rooms
export async function POST(req: Request) {
  if (!adminEnabled()) return Response.json({ ok: false, error: "admin_off" }, { status: 404 });
  if (!isAdminRequest(req)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { action?: unknown; id?: unknown; ids?: unknown } | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const needsId = action !== "families_purge";
  if (!action || (needsId && !/^[0-9a-f]{12}$/.test(id))) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });

  switch (action) {
    case "family_delete": {
      const rec = await loadFamily(id);
      if (!rec) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
      // The subscription lives at Stripe: cancel it there first, or the customer keeps paying for nothing.
      if (hasLiveSubscription(rec)) return Response.json({ ok: false, error: "has_subscription" }, { status: 409 });
      await deleteFamily(id);
      await recordAdminAction(action, id, `${rec.items.length} items`);
      return Response.json({ ok: true });
    }
    case "family_reset_usage": {
      const rec = await loadFamily(id);
      if (!rec) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
      const month = new Date().toISOString().slice(0, 7);
      const was = rec.usage[month] ?? 0;
      rec.usage[month] = 0;
      await saveFamily(rec);
      await recordAdminAction(action, id, `${was} -> 0`);
      return Response.json({ ok: true, was });
    }
    case "families_purge": {
      // Exactly the families the operator was shown, and only those still unused now.
      const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f]{12}$/.test(x)))].slice(0, 2000) : [];
      let removed = 0;
      for (const fid of ids) {
        const rec = await loadFamily(fid);
        if (rec && isAbandoned(rec)) {
          await deleteFamily(fid);
          removed++;
        }
      }
      await recordAdminAction(action, "-", `${removed} removed`);
      return Response.json({ ok: true, removed });
    }
    case "room_unlist": {
      const room = await loadRoom(id);
      if (!room) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
      room.listed = false;
      await saveRoom(room);
      await syncDirectory(await loadTeacher(room.teacherId), [room]);
      await recordAdminAction(action, id, room.name);
      return Response.json({ ok: true });
    }
    case "room_delete": {
      const room = await loadRoom(id);
      if (!room) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
      const teacher = await loadTeacher(room.teacherId);
      await deleteRoom(id);
      await removeFromDirectory([id]);
      if (teacher) {
        teacher.roomIds = teacher.roomIds.filter((r) => r !== id);
        await saveTeacher(teacher);
      }
      await recordAdminAction(action, id, `${room.name} (${room.members.length} following)`);
      return Response.json({ ok: true });
    }
    case "teacher_delete": {
      const teacher = await loadTeacher(id);
      if (!teacher) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
      const rooms = await loadRooms(teacher);
      for (const room of rooms) await deleteRoom(room.id);
      await deleteTeacher(id);
      await removeFromDirectory(rooms.map((r) => r.id));
      await forgetSchoolIfUnused(schoolIdOf(teacher));
      await recordAdminAction(action, id, `${rooms.length} rooms`);
      return Response.json({ ok: true, rooms: rooms.length });
    }
    default:
      return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
}
