import { translatePost } from "@/lib/assist";
import { isPaused } from "@/lib/ops";
import { allowRequest, clientIp, returnCodeGuess, takeCodeGuess } from "@/lib/ratelimit";
import { backfill, loadRoom, loadTeacher, parseJoinToken, postsNeedingTranslation, recentPosts, roomPublic, sanitizeChildIds, saveRoom, senderOf, subscribe, touchDirectory, verifyJoinCode, verifyJoinSecret } from "@/lib/rooms";
import { createFamily, familyCookie, familyFromRequest, isHttps, saveFamily, toView } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// A parent opens a room's invite link (/join?r=<room id>.<secret>) or found the room in
// the directory (/join, "find your class") and has the class code from the teacher.
// GET ?r=: what the room is, before joining. GET ?id=: the same for a listed room, without
// the secret. POST { token, childIds } or { roomId, code, childIds }: follow it. A browser
// without a family gets one created here, as on the first upload; the room's recent posts
// are written onto the list straight away, translated first when the family reads a
// language none of the earlier members did (one call per post, a few at most).

type Found = { status: 400 | 403 | 404 } | { status: 200; room: Awaited<ReturnType<typeof loadRoom>> & object; teacher: Awaited<ReturnType<typeof loadTeacher>> };

async function roomFor(token: unknown): Promise<Found> {
  const parsed = parseJoinToken(token);
  if (!parsed) return { status: 400 };
  const room = await loadRoom(parsed.id);
  if (!room || !verifyJoinSecret(room, parsed.secret)) return { status: 404 };
  return { status: 200, room, teacher: await loadTeacher(room.teacherId) };
}

// A listed room by id; the class code is checked only on POST.
async function listedRoom(id: unknown, code?: unknown): Promise<Found> {
  if (typeof id !== "string" || !/^[0-9a-f]{12}$/.test(id)) return { status: 400 };
  const room = await loadRoom(id);
  const teacher = room ? await loadTeacher(room.teacherId) : null;
  if (!room || !room.listed || !teacher?.school) return { status: 404 };
  if (code !== undefined && !verifyJoinCode(room, code)) return { status: 403 };
  return { status: 200, room, teacher };
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const found = params.get("id") ? await listedRoom(params.get("id")) : await roomFor(params.get("r"));
  if (found.status !== 200) return Response.json({ ok: false, error: "bad_token" }, { status: found.status });
  const rec = await familyFromRequest(req);
  const following = Boolean(rec && (rec.rooms ?? []).some((s) => s.roomId === found.room.id));
  const sub = rec?.rooms?.find((s) => s.roomId === found.room.id) ?? null;
  return Response.json({ ok: true, room: roomPublic(found.room, found.teacher), following, childIds: sub?.childIds ?? [] }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  let rec = await familyFromRequest(req);
  // Joining may translate recent posts: a paused family does not get to spend that.
  if (rec && (await isPaused(rec.id))) return Response.json({ ok: false, error: "blocked" }, { status: 403 });
  const gate = await allowRequest({ ip: clientIp(req), family: rec?.id ?? null });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason }, { status: 429 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  const byCode = body.roomId !== undefined;
  const guessed = byCode && typeof body.roomId === "string" && /^[0-9a-f]{12}$/.test(body.roomId) ? body.roomId : null;
  const guess = guessed ? await takeCodeGuess(guessed) : null;
  if (guessed && !guess) return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  let found: Found;
  try {
    found = byCode ? await listedRoom(body.roomId, body.code ?? "") : await roomFor(body.token);
  } catch (e) {
    // not a wrong code: the guess goes back
    if (guess) await returnCodeGuess(guess);
    throw e;
  }
  if (guess && found.status !== 403) await returnCodeGuess(guess);
  if (found.status !== 200) return Response.json({ ok: false, error: found.status === 403 ? "bad_code" : "bad_token" }, { status: found.status });
  const { room, teacher } = found;

  const headers: Record<string, string> = {};
  let key: string | undefined;
  if (!rec) {
    const created = createFamily({ locale: typeof body.locale === "string" ? body.locale : null, timezone: typeof body.timezone === "string" ? body.timezone : null });
    rec = created.record;
    key = created.key;
    headers["set-cookie"] = familyCookie(created.key, isHttps(req));
  }
  const sender = senderOf(teacher);
  const result = subscribe(rec, room, sender, sanitizeChildIds(body.childIds, rec));
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
    got = backfill(rec, room, sender);
  }
  await saveFamily(rec);
  await saveRoom(room);
  if (result.isNew) await touchDirectory(room);
  console.log(JSON.stringify({ event: "room_join", family: rec.id, room: room.id, new: result.isNew, language: rec.settings.language, translated, backfilled: got }));
  return Response.json({ ok: true, family: toView(rec), key, room: roomPublic(room, teacher), backfilled: got }, { headers });
}
