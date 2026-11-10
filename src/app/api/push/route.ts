import { addPushSub, notifyFamily, pushEnabled, removePushSub, sanitizePushSub } from "@/lib/push";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { familyFromRequest, saveFamily, toView } from "@/lib/store";

export const runtime = "nodejs";

// Notifications for this device. POST { subscription }: switch on (the browser's push
// address is stored with the family). POST { test: true }: send a test to the family's
// devices. DELETE { endpoint }: switch off and forget the address.
export async function POST(req: Request) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  if (!pushEnabled()) return Response.json({ ok: false, error: "server_not_configured" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  if (body.test === true) {
    const gate = allowRequest({ ip: clientIp(req), family: rec.id });
    if (!gate.ok) return Response.json({ ok: false, error: gate.reason }, { status: 429 });
    const sent = await notifyFamily(rec, { title: "ParentDesk", body: "✓", url: "/" });
    return Response.json({ ok: true, sent });
  }
  const sub = sanitizePushSub(body.subscription);
  if (!sub) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  addPushSub(rec, sub);
  await saveFamily(rec);
  return Response.json({ ok: true, family: toView(rec) });
}

export async function DELETE(req: Request) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.endpoint !== "string") return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  if (removePushSub(rec, body.endpoint)) await saveFamily(rec);
  return Response.json({ ok: true, family: toView(rec) });
}
