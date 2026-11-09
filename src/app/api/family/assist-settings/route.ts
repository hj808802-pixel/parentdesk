import { modelErrorResponse } from "@/lib/apierror";
import { suggestSettings } from "@/lib/assist";
import { todayIn } from "@/lib/dates";
import { isLocale } from "@/lib/i18n/locales";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { familyFromRequest } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// "Add my second child Mia", "we moved to Japan": the assistant turns plain words into a
// settings suggestion. Nothing is changed here; the browser shows the changes and saves
// them through the ordinary family PATCH once the parent agrees. Nothing is written here,
// so a save made while the model is running is never overwritten.
export async function POST(req: Request) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const text = body && typeof body.text === "string" ? body.text.trim() : "";
  if (!body || !text || text.length > 600) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  const locale = typeof body.locale === "string" && isLocale(body.locale) ? body.locale : rec.settings.locale || "en";
  const gate = allowRequest({ ip: clientIp(req), family: rec.id });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason, retry_after: gate.retryAfterSec }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } });

  const started = Date.now();
  try {
    const out = await suggestSettings(rec, text, locale, todayIn(rec.settings.timezone));
    console.log(JSON.stringify({ event: "setup", family: rec.id, ms: Date.now() - started, model: out.model, mock: out.mock }));
    return Response.json({ ok: true, ...out.result, mock: out.mock });
  } catch (e) {
    return modelErrorResponse(e, "setup");
  }
}
