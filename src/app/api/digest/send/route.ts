import { todayIn } from "@/lib/dates";
import { buildDigest, MailError, sendEmail, unsubscribeToken } from "@/lib/digest";
import { canUse } from "@/lib/plan";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { siteOrigin } from "@/lib/request";
import { bumpCounter, digestEnabled, familyFromRequest, saveFamily, toView } from "@/lib/store";

export const runtime = "nodejs";

// "Send a test now": one summary to the address in Settings. At most one every ten
// minutes per family.

const MIN_GAP_MS = 10 * 60_000;

export async function POST(req: Request) {
  if (!digestEnabled()) return Response.json({ ok: false, error: "digest_off" }, { status: 404 });
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  if (!canUse(rec, "digest")) return Response.json({ ok: false, error: "plan_limit" }, { status: 402 });
  if (!rec.settings.digestEmail) return Response.json({ ok: false, error: "no_email" }, { status: 400 });
  const gate = allowRequest({ ip: clientIp(req), family: rec.id });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason, retry_after: gate.retryAfterSec }, { status: 429 });
  const last = rec.digest?.lastSentAt ? Date.parse(rec.digest.lastSentAt) : 0;
  if (Date.now() - last < MIN_GAP_MS) return Response.json({ ok: false, error: "rate_limited", retry_after: Math.ceil((MIN_GAP_MS - (Date.now() - last)) / 1000) }, { status: 429 });

  const origin = siteOrigin(req);
  const unsub = unsubscribeToken(rec.id);
  const d = buildDigest(rec, todayIn(rec.settings.timezone), { origin, unsubscribeUrl: unsub ? `${origin}/api/digest/unsubscribe?u=${unsub}` : null });
  rec.digest ??= { lastSentAt: null, lastWeeklyAt: null, lastError: null };
  try {
    await sendEmail({ to: rec.settings.digestEmail, subject: d.subject, text: d.text, html: d.html, unsubscribeUrl: unsub ? `${origin}/api/digest/unsubscribe?u=${unsub}` : null });
    rec.digest.lastSentAt = new Date().toISOString();
    rec.digest.lastError = null;
    bumpCounter(rec, "digest");
    await saveFamily(rec);
    console.log(JSON.stringify({ event: "digest_test", family: rec.id, items: d.count }));
    return Response.json({ ok: true, family: toView(rec) });
  } catch (e) {
    rec.digest.lastError = e instanceof MailError ? e.code : "api";
    await saveFamily(rec);
    console.error("[digest] send", rec.id, e);
    return Response.json({ ok: false, error: "mail_error" }, { status: 502 });
  }
}
