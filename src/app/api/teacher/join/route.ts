import { allowRequest, clientIp } from "@/lib/ratelimit";
import { loadRooms, loadTeacher, parseTeacherKey, teacherCookie, teacherView, verifyTeacherSecret } from "@/lib/rooms";
import { isHttps } from "@/lib/store";

export const runtime = "nodejs";

// Opens a teacher's desk on another device with the teacher key ({ key }).
export async function POST(req: Request) {
  const gate = await allowRequest({ ip: clientIp(req), family: null });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason }, { status: 429 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseTeacherKey(body?.key);
  if (!parsed) return Response.json({ ok: false, error: "bad_key" }, { status: 400 });
  const teacher = await loadTeacher(parsed.id);
  if (!teacher || !verifyTeacherSecret(teacher, parsed.secret)) return Response.json({ ok: false, error: "bad_key" }, { status: 404 });
  return Response.json({ ok: true, teacher: teacherView(teacher, await loadRooms(teacher)) }, { headers: { "set-cookie": teacherCookie(`pdt_${parsed.id}_${parsed.secret}`, isHttps(req)) } });
}
