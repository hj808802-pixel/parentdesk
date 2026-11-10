import { modelErrorResponse } from "@/lib/apierror";
import { isTeacherPaused } from "@/lib/ops";
import { todayIn } from "@/lib/dates";
import { extractNotice, type ImageMediaType, type InputFile } from "@/lib/extract";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { addDraft, canPost, loadRoom, loadRooms, makePost, saveRoom, saveTeacher, sendPost, teacherContext, teacherFromRequest, teacherView } from "@/lib/rooms";

export const runtime = "nodejs";
export const maxDuration = 60;

// A teacher reads a notice into a room: text, photos or a PDF, as on the Add page. The
// notice is extracted once in the teacher's result language. By default the result is
// kept as a draft for the teacher to check (mode=preview); drafts/[id] sends it. With
// mode=send it goes straight to the following families. Files are read and discarded.

const IMAGE_TYPES = new Set<string>(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_FILES = 5;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4.3 * 1024 * 1024;
const MIN_TEXT_CHARS = 10;
const MAX_TEXT_CHARS = 20000;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const fail = (code: string, status: number, extra: Record<string, unknown> = {}) => Response.json({ ok: false, error: code, request_id: requestId, ...extra }, { status });

  const teacher = await teacherFromRequest(req);
  if (!teacher) return fail("no_teacher", 404);
  if (await isTeacherPaused(teacher.id)) return fail("blocked", 403);
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
  const mode = form.get("mode") === "send" ? "send" : "preview";
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
    teacher.usage[month] = (teacher.usage[month] ?? 0) + 1; // the extraction happened, sent or not

    if (mode === "preview") {
      addDraft(room, post);
      await saveRoom(room);
      await saveTeacher(teacher);
      console.log(JSON.stringify({ event: "room_draft", request_id: requestId, teacher: teacher.id, room: room.id, pages: inputs.length, items: post.items.length, ms: Date.now() - started, model: out.model, usage: out.usage ?? null, mock: out.mock }));
      return Response.json({ ok: true, request_id: requestId, saved: false, preview: true, school_related: true, draft: post, teacher: teacherView(teacher, await loadRooms(teacher)), mock: out.mock });
    }

    const sent = await sendPost(teacher, [room], post);
    await saveTeacher(teacher);
    console.log(
      JSON.stringify({
        event: "room_post",
        request_id: requestId,
        teacher: teacher.id,
        room: room.id,
        pages: inputs.length,
        items: post.items.length,
        members: sent.members,
        delivered: sent.delivered,
        items_delivered: sent.items,
        languages: sent.languages,
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
      delivered: sent.delivered,
      members: sent.members,
      languages: sent.languages,
      teacher: teacherView(teacher, await loadRooms(teacher)),
      mock: out.mock,
    });
  } catch (e) {
    return modelErrorResponse(e, "room post", requestId);
  }
}
