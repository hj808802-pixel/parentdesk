import { isLocale, localePath } from "@/lib/i18n/locales";
import { canUse } from "@/lib/plan";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { localeOf, siteOrigin } from "@/lib/request";
import { createInvite, familyFromRequest, saveFamily, toView } from "@/lib/store";

export const runtime = "nodejs";

// A partner invite link. The server keeps a hash; the link carries the secret and works a
// few times for a few days (store.ts INVITE_*). Family-plan feature once billing is on.

export async function POST(req: Request) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  if (!canUse(rec, "invite")) return Response.json({ ok: false, error: "plan_limit" }, { status: 402 });
  const gate = allowRequest({ ip: clientIp(req), family: rec.id });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason, retry_after: gate.retryAfterSec }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const locale = isLocale(body.locale) ? body.locale : localeOf(req);
  const made = createInvite(rec);
  if (!made) return Response.json({ ok: false, error: "too_many_invites" }, { status: 429 });
  await saveFamily(rec);
  const url = `${siteOrigin(req)}${localePath(locale, "/join")}?i=${made.token}`;
  return Response.json({ ok: true, url, expiresAt: made.invite.expiresAt, maxUses: made.invite.maxUses, family: toView(rec) });
}
