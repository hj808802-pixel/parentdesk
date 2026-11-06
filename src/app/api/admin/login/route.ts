import { adminCookie, adminEnabled, checkAdminToken, clearAdminCookie } from "@/lib/admin";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { isHttps } from "@/lib/store";

export const runtime = "nodejs";

// POST { token } → the admin cookie. DELETE → sign out.

export async function POST(req: Request) {
  if (!adminEnabled()) return Response.json({ ok: false, error: "admin_off" }, { status: 404 });
  const gate = allowRequest({ ip: clientIp(req), family: null });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason }, { status: 429 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!checkAdminToken(body?.token)) return Response.json({ ok: false, error: "bad_token" }, { status: 401 });
  return Response.json({ ok: true }, { headers: { "set-cookie": adminCookie(isHttps(req)) } });
}

export async function DELETE(req: Request) {
  return Response.json({ ok: true }, { headers: { "set-cookie": clearAdminCookie(isHttps(req)) } });
}
