import { todayIn } from "@/lib/dates";
import { buildDigest } from "@/lib/digest";
import { localeOf, siteOrigin } from "@/lib/request";
import { familyFromRequest } from "@/lib/store";

export const runtime = "nodejs";

// The weekly summary as it would be sent today, for the Settings preview. Works whether
// or not e-mail sending is configured.

export async function GET(req: Request) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  const d = buildDigest(rec, todayIn(rec.settings.timezone), { origin: siteOrigin(req), fallbackLocale: localeOf(req) });
  return Response.json({ ok: true, subject: d.subject, text: d.text, count: d.count }, { headers: { "cache-control": "no-store" } });
}
