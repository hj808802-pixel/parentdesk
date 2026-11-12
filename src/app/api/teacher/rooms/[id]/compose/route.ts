import { modelErrorResponse } from "@/lib/apierror";
import { isTeacherPaused } from "@/lib/ops";
import { composeNotice } from "@/lib/assist";
import { NOTICE_KINDS, type NoticeKind } from "@/lib/schema";
import { todayIn } from "@/lib/dates";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { loadRoom, teacherFromRequest } from "@/lib/rooms";

export const runtime = "nodejs";
export const maxDuration = 60;

// A few facts in, a complete notice out, in the teacher's language. Nothing is stored; the
// teacher edits the text and reads it into a draft like any other notice.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const teacher = await teacherFromRequest(req);
  if (!teacher) return Response.json({ ok: false, error: "no_teacher" }, { status: 404 });
  if (await isTeacherPaused(teacher.id)) return Response.json({ ok: false, error: "blocked" }, { status: 403 });
  const { id } = await params;
  const room = await loadRoom(id);
  if (!room || room.teacherId !== teacher.id) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const gate = await allowRequest({ ip: clientIp(req), family: `t:${teacher.id}` });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason, retry_after: gate.retryAfterSec }, { status: 429 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  const facts = typeof body.facts === "string" ? body.facts.trim().slice(0, 4000) : "";
  if (facts.length < 5) return Response.json({ ok: false, error: "text_too_short" }, { status: 400 });
  const kind = (NOTICE_KINDS as readonly string[]).includes(String(body.kind)) ? (body.kind as NoticeKind) : "general";
  const tone = body.tone === "friendly" ? "friendly" : "formal";

  const started = Date.now();
  try {
    const out = await composeNotice(teacher, room.name, { kind, facts, tone }, todayIn(teacher.settings.timezone));
    console.log(JSON.stringify({ event: "compose", teacher: teacher.id, room: room.id, kind, tone, chars: facts.length, ms: Date.now() - started, model: out.model, mock: out.mock }));
    return Response.json({ ok: true, ...out.result, mock: out.mock });
  } catch (e) {
    return modelErrorResponse(e, "compose");
  }
}
