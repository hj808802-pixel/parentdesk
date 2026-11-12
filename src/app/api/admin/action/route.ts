import { adminEnabled, adminOf, createAdmin, hasLiveSubscription, isAbandoned, removeAdmin, rotateAdmin } from "@/lib/admin";
import { newTotpSecret, totpUri } from "@/lib/totp";
import { translateAnnouncement } from "@/lib/assist";
import { readFamilyAdmin, recordAdminAction as logAction, removeFamilyAdmin, setAnnouncement, setTeacherPaused, writeFamilyAdmin } from "@/lib/ops";
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
//   family_note        { id, note }: the operator's own note on a family
//   family_block       { id, blocked }: pauses (or resumes) a family's model use: adding notices, asking, drafting
//   announce           { text, audience, days, translate }: the banner teachers and/or families see, in ten
//                      languages when translate is true; empty text clears it
//   teacher_block      { id, blocked, reason }: pauses (or resumes) a teacher desk: reading, writing and sending
//                      notices; the reason is shown to the teacher
//   admin_add          { name, role, twoStep }: a new console account; its token (and secret) come back once
//   admin_rotate       { name }: a new token for a console-made account (the old one stops working)
//   admin_remove       { name }: takes a console-made account away; nobody can remove themselves
export async function POST(req: Request) {
  if (!adminEnabled()) return Response.json({ ok: false, error: "admin_off" }, { status: 404 });
  const me = await adminOf(req);
  if (!me) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  // Viewers may look at everything and change nothing.
  if (me.role !== "owner") return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const recordAdminAction = (action: string, target: string, note = "") => logAction(action, target, note, me.name);
  const body = (await req.json().catch(() => null)) as { action?: unknown; id?: unknown; ids?: unknown; note?: unknown; blocked?: unknown; text?: unknown; audience?: unknown; days?: unknown; translate?: unknown; name?: unknown; role?: unknown; twoStep?: unknown; reason?: unknown } | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const needsId = !["families_purge", "announce", "admin_add", "admin_remove", "admin_rotate"].includes(action);
  if (!action || (needsId && !/^[0-9a-f]{12}$/.test(id))) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });

  switch (action) {
    case "family_delete": {
      const rec = await loadFamily(id);
      if (!rec) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
      // The subscription lives at Stripe: cancel it there first, or the customer keeps paying for nothing.
      if (hasLiveSubscription(rec)) return Response.json({ ok: false, error: "has_subscription" }, { status: 409 });
      await deleteFamily(id);
      await removeFamilyAdmin(id);
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
    case "family_note":
    case "family_block": {
      const rec = await loadFamily(id);
      if (!rec) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
      // Kept beside the family, not in it: a family save already under way cannot undo it.
      const next = await writeFamilyAdmin(id, action === "family_note" ? { note: typeof body?.note === "string" ? body.note.replace(/\s+/g, " ").trim().slice(0, 300) : "" } : { blocked: body?.blocked === true });
      await recordAdminAction(action, id, action === "family_note" ? "note saved" : next.blocked ? "paused" : "resumed");
      return Response.json({ ok: true });
    }
    case "announce": {
      const audience = body?.audience === "teachers" || body?.audience === "families" ? body.audience : "all";
      const text = typeof body?.text === "string" ? body.text.trim().slice(0, 500) : "";
      // One assistant call writes it in all ten UI languages; if that fails the original goes out as it is.
      let texts: Record<string, string> | undefined;
      let translated = false;
      if (text && body?.translate === true) {
        try {
          texts = (await translateAnnouncement(text)).result;
          translated = true;
        } catch (e) {
          console.warn("[announce] translation failed", e instanceof Error ? e.message : e);
        }
      }
      const doc = await setAnnouncement(text, audience, typeof body?.days === "number" ? body.days : 7, texts);
      await recordAdminAction(action, "-", doc ? `${audience}, until ${doc.until.slice(0, 10)}${translated ? ", 10 languages" : ""}` : "cleared");
      return Response.json({ ok: true, announcement: doc, translated });
    }
    case "families_purge": {
      // Exactly the families the operator was shown, and only those still unused now.
      const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f]{12}$/.test(x)))].slice(0, 2000) : [];
      let removed = 0;
      for (const fid of ids) {
        const rec = await loadFamily(fid);
        const mark = rec ? await readFamilyAdmin(fid) : null;
        if (rec && isAbandoned(rec) && !mark?.note && !mark?.blocked) {
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
    case "admin_add": {
      const made = await createAdmin(body?.name, body?.role, body?.twoStep === true, newTotpSecret);
      if (!made.ok) return Response.json({ ok: false, error: made.error }, { status: made.error === "exists" ? 409 : 400 });
      await recordAdminAction(action, made.name, `${made.role}${made.totp ? ", two-step" : ""}`);
      return Response.json({ ok: true, account: { name: made.name, role: made.role, token: made.token, totp: made.totp, totpUri: made.totp ? totpUri(made.totp, `ParentDesk admin (${made.name})`) : null } }, { headers: { "cache-control": "no-store" } });
    }
    case "admin_rotate": {
      const target = typeof body?.name === "string" ? body.name.trim().toLowerCase() : "";
      if (target === me.name) return Response.json({ ok: false, error: "self" }, { status: 400 });
      const res = await rotateAdmin(target);
      if (!res.ok) return Response.json({ ok: false, error: res.error === "env" ? "env_account" : res.error }, { status: res.error === "env" ? 400 : res.error === "conflict" ? 409 : 404 });
      await recordAdminAction(action, target, "new token");
      return Response.json({ ok: true, account: { name: res.name, role: res.role, token: res.token, totp: null, totpUri: null } }, { headers: { "cache-control": "no-store" } });
    }
    case "admin_remove": {
      const target = typeof body?.name === "string" ? body.name.trim().toLowerCase() : "";
      if (target === me.name) return Response.json({ ok: false, error: "self" }, { status: 400 });
      const res = await removeAdmin(target);
      if (res !== "removed") return Response.json({ ok: false, error: res === "env" ? "env_account" : "not_found" }, { status: res === "env" ? 400 : 404 });
      await recordAdminAction(action, target, "removed");
      return Response.json({ ok: true });
    }
    case "teacher_block": {
      const teacher = await loadTeacher(id);
      if (!teacher) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
      const reason = typeof body?.reason === "string" ? body.reason.replace(/\s+/g, " ").trim().slice(0, 200) : "";
      await setTeacherPaused(id, body?.blocked === true, reason);
      await recordAdminAction(action, id, body?.blocked === true ? `paused${reason ? `: ${reason}` : ""}` : "resumed");
      return Response.json({ ok: true });
    }
    case "teacher_delete": {
      const teacher = await loadTeacher(id);
      if (!teacher) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
      const rooms = await loadRooms(teacher);
      for (const room of rooms) await deleteRoom(room.id);
      await deleteTeacher(id);
      await setTeacherPaused(id, false);
      await removeFromDirectory(rooms.map((r) => r.id));
      await forgetSchoolIfUnused(schoolIdOf(teacher));
      await recordAdminAction(action, id, `${rooms.length} rooms`);
      return Response.json({ ok: true, rooms: rooms.length });
    }
    default:
      return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
}
