import { modelErrorResponse } from "@/lib/apierror";
import { translatePost } from "@/lib/assist";
import { todayIn } from "@/lib/dates";
import { extractNotice, type ImageMediaType, type InputFile } from "@/lib/extract";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { addPost, canPost, deliverPost, loadRoom, loadRooms, makePost, saveRoom, saveTeacher, teacherContext, teacherFromRequest, teacherView, type RoomRecord } from "@/lib/rooms";
import { loadFamily, saveFamily, type FamilyRecord } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// A teacher posts a notice to a room: text, photos or a PDF, as on the Add page. The
// notice is extracted once (in the teacher's result language), translated once per result
// language the following families use, and written onto every one of their lists. The
// files are read and discarded; the room keeps the extracted items and a summary.

const IMAGE_TYPES = new Set<string>(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_FILES = 5;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4.3 * 1024 * 1024;
const MIN_TEXT_CHARS = 10;
const MAX_TEXT_CHARS = 20000;
const DELIVERY_BATCH = 8;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const fail = (code: string, status: number, extra: Record<string, unknown> = {}) => Response.json({ ok: false, error: code, request_id: requestId, ...extra }, { status });

  const teacher = await teacherFromRequest(req);
  if (!teacher) return fail("no_teacher", 404);
  const { id } = await params;
  const room = await loadRoom(id);
  if (!room || room.teacherId !== teacher.id) return fail("not_found", 404);

  const gate = allowRequest({ ip: clientIp(req), family: `t:${teacher.id}` });
  if (!gate.ok) return fail(gate.reason, 429, { retry_after: gate.retryAfterSec });
  const month = todayIn(teacher.settings.timezone).slice(0, 7);
  const cap = canPost(teacher, month);
  if (!cap.ok) return fail("post_limit", 429, { used: cap.used, limit: cap.limit });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("bad_form", 400);
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const text = String(form.get("text") ?? "").trim();
  if (files.length === 0 && !text) return fail("no_files", 400);
  if (files.length === 0 && text.length < MIN_TEXT_CHARS) return fail("text_too_short", 400);
  if (text.length > MAX_TEXT_CHARS) return fail("too_large", 413);
  if (files.length > MAX_FILES) return fail("too_many_files", 400);

  const inputs: InputFile[] = [];
  let total = 0;
  for (const f of files) {
    total += f.size;
    if (f.size > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) return fail("too_large", 413);
    const base64 = Buffer.from(await f.arrayBuffer()).toString("base64");
    if (f.type === "application/pdf") inputs.push({ kind: "pdf", base64 });
    else if (IMAGE_TYPES.has(f.type)) inputs.push({ kind: "image", mediaType: f.type as ImageMediaType, base64 });
    else return fail("unsupported_type", 400);
  }
  if (text) inputs.push({ kind: "text", text });

  const started = Date.now();
  try {
    const out = await extractNotice(inputs, teacherContext(teacher));
    if (!out.result.is_school_related) {
      return Response.json({ ok: true, request_id: requestId, saved: false, school_related: false, summary: out.result.source.summary, mock: out.mock });
    }
    const post = makePost(room, teacher, out.result, inputs.length);

    // Who follows the room, and which result languages they read.
    const families = await loadMembers(room);
    const languages = [...new Set(families.map((f) => f.settings.language))].filter((l) => l !== post.language);
    const translated = await Promise.allSettled(languages.map((lang) => translatePost(post, post.language, lang)));
    translated.forEach((r, i) => {
      if (r.status === "fulfilled") post.translations[languages[i]] = r.value.result;
      else console.warn("[room post] translation failed", languages[i], r.reason instanceof Error ? r.reason.message : r.reason);
    });

    // Fan out, a few families at a time.
    let delivered = 0;
    let itemsDelivered = 0;
    for (let i = 0; i < families.length; i += DELIVERY_BATCH) {
      await Promise.all(
        families.slice(i, i + DELIVERY_BATCH).map(async (fam) => {
          const res = deliverPost(fam, room, post, teacher.name);
          if (!res) return;
          try {
            await saveFamily(fam);
            delivered++;
            itemsDelivered += res.items.length;
          } catch (e) {
            console.error("[room post] save failed", fam.id, e);
          }
        }),
      );
    }
    post.delivered = delivered;
    addPost(room, post);
    teacher.usage[month] = (teacher.usage[month] ?? 0) + 1;
    await saveRoom(room);
    await saveTeacher(teacher);

    console.log(
      JSON.stringify({
        event: "room_post",
        request_id: requestId,
        teacher: teacher.id,
        room: room.id,
        pages: inputs.length,
        items: post.items.length,
        members: families.length,
        delivered,
        items_delivered: itemsDelivered,
        languages,
        ms: Date.now() - started,
        model: out.model,
        usage: out.usage ?? null,
        mock: out.mock,
      }),
    );
    return Response.json({
      ok: true,
      request_id: requestId,
      saved: true,
      school_related: true,
      post,
      delivered,
      members: families.length,
      languages,
      teacher: teacherView(teacher, await loadRooms(teacher)),
      mock: out.mock,
    });
  } catch (e) {
    return modelErrorResponse(e, "room post", requestId);
  }
}

// The member families that still exist and still follow the room. Members that are gone
// are dropped from the room on the way.
async function loadMembers(room: RoomRecord): Promise<FamilyRecord[]> {
  const loaded = await Promise.all(room.members.map((m) => loadFamily(m.familyId)));
  const keep = new Set<string>();
  const families: FamilyRecord[] = [];
  loaded.forEach((fam) => {
    if (fam && (fam.rooms ?? []).some((s) => s.roomId === room.id)) {
      keep.add(fam.id);
      families.push(fam);
    }
  });
  room.members = room.members.filter((m) => keep.has(m.familyId));
  return families;
}
