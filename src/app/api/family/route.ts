import { maxChildrenFor } from "@/lib/plan";
import { allowSignup, clientIp } from "@/lib/ratelimit";
import {
  MAX_CHILDREN,
  clearFamilyCookie,
  createFamily,
  deleteFamily,
  familyCookie,
  familyFromRequest,
  isHttps,
  sanitizeChildren,
  sanitizeSettings,
  saveFamily,
  toView,
} from "@/lib/store";

export const runtime = "nodejs";

// The family document behind the HttpOnly cookie.
// GET: current family. POST: create one and set the cookie. PATCH: settings and children.
// DELETE: remove everything and clear the cookie.

export async function GET(req: Request) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  return Response.json({ ok: true, family: toView(rec) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const existing = await familyFromRequest(req);
  if (existing) return Response.json({ ok: true, family: toView(existing) });
  const gate = allowSignup(clientIp(req));
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason, retry_after: gate.retryAfterSec }, { status: 429 });
  const { record, key } = createFamily({
    locale: typeof body.locale === "string" ? body.locale : null,
    timezone: typeof body.timezone === "string" ? body.timezone : null,
    settings: body.settings && typeof body.settings === "object" ? (body.settings as Record<string, unknown>) : undefined,
  });
  await saveFamily(record);
  return Response.json({ ok: true, family: toView(record), key }, { headers: { "set-cookie": familyCookie(key, isHttps(req)) } });
}

export async function PATCH(req: Request) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  if (body.settings) rec.settings = sanitizeSettings(body.settings, rec.settings);
  if (body.children) {
    rec.children = sanitizeChildren(body.children, rec.children, maxChildrenFor(rec, MAX_CHILDREN));
    const ids = new Set(rec.children.map((c) => c.id));
    for (const it of rec.items) it.childIds = it.childIds.filter((id) => ids.has(id));
  }
  await saveFamily(rec);
  return Response.json({ ok: true, family: toView(rec) });
}

export async function DELETE(req: Request) {
  const rec = await familyFromRequest(req);
  if (rec) await deleteFamily(rec.id);
  return Response.json({ ok: true }, { headers: { "set-cookie": clearFamilyCookie(isHttps(req)) } });
}
