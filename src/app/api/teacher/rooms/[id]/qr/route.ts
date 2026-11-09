import { isLocale, localePath } from "@/lib/i18n/locales";
import { qrSvg } from "@/lib/qr";
import { localeOf, siteOrigin } from "@/lib/request";
import { joinTokenOf, loadRoom, teacherFromRequest } from "@/lib/rooms";

export const runtime = "nodejs";

// The room's invite link as a QR code (SVG), for the teacher who owns the room. ?l=<locale>
// picks the language the link opens in; the UI passes its own.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const teacher = await teacherFromRequest(req);
  if (!teacher) return Response.json({ ok: false, error: "no_teacher" }, { status: 404 });
  const { id } = await params;
  const room = await loadRoom(id);
  if (!room || room.teacherId !== teacher.id) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const l = new URL(req.url).searchParams.get("l");
  const locale = isLocale(l) ? l : localeOf(req);
  const link = `${siteOrigin(req)}${localePath(locale, "/join")}?r=${joinTokenOf(room)}`;
  const svg = await qrSvg(link);
  return new Response(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "private, no-store" } });
}
