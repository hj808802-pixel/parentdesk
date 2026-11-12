import { modelErrorResponse } from "@/lib/apierror";
import { isTeacherPaused } from "@/lib/ops";
import { helpParentMessage } from "@/lib/assist";
import { todayIn } from "@/lib/dates";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { teacherFromRequest } from "@/lib/rooms";

export const runtime = "nodejs";
export const maxDuration = 60;

// A parent's message, in any language: translated for the teacher, summed up, and answered
// with a suggested reply in the parent's language. Nothing is stored.
export async function POST(req: Request) {
  const teacher = await teacherFromRequest(req);
  if (!teacher) return Response.json({ ok: false, error: "no_teacher" }, { status: 404 });
  if (await isTeacherPaused(teacher.id)) return Response.json({ ok: false, error: "blocked" }, { status: 403 });
  const gate = await allowRequest({ ip: clientIp(req), family: `t:${teacher.id}` });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason, retry_after: gate.retryAfterSec }, { status: 429 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 4000) : "";
  if (text.length < 2) return Response.json({ ok: false, error: "text_too_short" }, { status: 400 });

  const started = Date.now();
  try {
    const out = await helpParentMessage(teacher, text, todayIn(teacher.settings.timezone));
    console.log(JSON.stringify({ event: "parent_message", teacher: teacher.id, chars: text.length, language: out.result.language, ms: Date.now() - started, model: out.model, mock: out.mock }));
    return Response.json({ ok: true, ...out.result, mock: out.mock });
  } catch (e) {
    return modelErrorResponse(e, "parent message");
  }
}
