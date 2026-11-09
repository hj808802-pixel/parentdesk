import { translatePost } from "@/lib/assist";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { backfill, loadRoom, loadTeacher, parseJoinToken, postsNeedingTranslation, recentPosts, roomPublic, sanitizeChildIds, saveRoom, subscribe, verifyJoinSecret } from "@/lib/rooms";
import { createFamily, familyCookie, familyFromRequest, isHttps, saveFamily, toView } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// A parent opens a room's invite link (/join?r=<room id>.<secret>).
// GET ?r=: what the room is, before joining. POST { token, childIds }: follow it. A browser
// without a family gets one created here, as on the first upload; the room's recent posts
// are written onto the list straight away, translated first when the family reads a
// language none of the earlier members did (one call per post, a few at most).

async function roomFor(token: unknown) {
  const parsed = parseJoinToken(token);
  if (!parsed) return { status: 400 as const };
  const room = await loadRoom(parsed.id);
  if (!room || !verifyJoinSecret(room, parsed.secret)) return { status: 404 as const };
  return { status: 200 as const, room, teacher: await loadTeacher(room.teacherId) };
}

export async function GET(req: Request) {
  const found = await roomFor(new URL(req.url).searchParams.get("r"));
  if (found.status !== 200) return Response.json({ ok: false, error: "bad_token" }, { status: found.status });
  const rec = await familyFromRequest(req);
  const following = Boolean(rec && (rec.rooms ?? []).some((s) => s.roomId === found.room.id));
  const sub = rec?.rooms?.find((s) => s.roomId === found.room.id) ?? null;
  return Response.json({ ok: true, room: roomPublic(found.room, found.teacher), following, childIds: sub?.childIds ?? [] }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  let rec = await familyFromRequest(req);
  const gate = allowRequest({ ip: clientIp(req), family: rec?.id ?? null });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason }, { status: 429 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  const found = await roomFor(body.token);
  if (found.status !== 200) return Response.json({ ok: false, error: "bad_token" }, { status: found.status });
  const { room, teacher } = found;

  const headers: Record<string, string> = {};
  let key: string | undefined;
  if (!rec) {
    const created = createFamily({ locale: typeof body.locale === "string" ? body.locale : null, timezone: typeof body.timezone === "string" ? body.timezone : null });
    rec = created.record;
    key = created.key;
    headers["set-cookie"] = familyCookie(created.key, isHttps(req));
  }
  const teacherName = teacher?.name ?? "";
  const result = subscribe(rec, room, teacherName, sanitizeChildIds(body.childIds, rec));
  if (!result.ok) return Response.json({ ok: false, error: result.reason }, { status: 409, headers });
  let got = { posts: 0, items: 0 };
  let translated = 0;
  if (result.isNew) {
    const pending = postsNeedingTranslation(recentPosts(room), rec.settings.language);
    const done = await Promise.allSettled(pending.map((p) => translatePost(p, p.language, rec.settings.language)));
    done.forEach((r, i) => {
      if (r.status === "fulfilled") {
        pending[i].translations[rec.settings.language] = r.value.result;
        translated++;
      } else console.warn("[room join] translation failed", pending[i].id, r.reason instanceof Error ? r.reason.message : r.reason);
    });
    got = backfill(rec, room, teacherName);
  }
  await saveFamily(rec);
  await saveRoom(room);
  console.log(JSON.stringify({ event: "room_join", family: rec.id, room: room.id, new: result.isNew, language: rec.settings.language, translated, backfilled: got }));
  return Response.json({ ok: true, family: toView(rec), key, room: roomPublic(room, teacher), backfilled: got }, { headers });
}
