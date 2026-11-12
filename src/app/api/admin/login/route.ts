import { adminByToken, adminCookieFor, adminEnabled, adminUsers, clearAdminCookie } from "@/lib/admin";
import { recordAdminAction } from "@/lib/ops";
import { allowSignIn, clientIp } from "@/lib/ratelimit";
import { verifyTotp } from "@/lib/totp";
import { isHttps } from "@/lib/store";

export const runtime = "nodejs";

// POST { token, code? } → the admin cookie (the 6-digit code is required when
// ADMIN_TOTP_SECRET is set; ten attempts an hour per address). DELETE → sign out.
// GET → whether the second step is on, so the page knows to ask for the code.
export async function GET() {
  return Response.json({ ok: true, enabled: adminEnabled(), twoStep: (await adminUsers()).some((u) => u.totp !== null) }, { headers: { "cache-control": "no-store" } });
}

// Enough of the address to recognise a pattern, not enough to identify a person.
const maskIp = (ip: string) => (ip.includes(".") ? ip.split(".").slice(0, 2).join(".") + ".x.x" : ip.split(":").slice(0, 3).join(":") + ":…");

export async function POST(req: Request) {
  if (!adminEnabled()) return Response.json({ ok: false, error: "admin_off" }, { status: 404 });
  const gate = allowSignIn(clientIp(req));
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason }, { status: 429 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const user = await adminByToken(body?.token);
  if (!user) return Response.json({ ok: false, error: "bad_token" }, { status: 401 });
  // A right token with a wrong code is worth knowing about (wrong tokens are not logged:
  // anyone could fill the record with them). Bounded by the sign-in limiter above.
  if (user.totp && !verifyTotp(user.totp, body?.code)) {
    await recordAdminAction("login_failed", user.name, `wrong code from ${maskIp(clientIp(req))}`, user.name).catch(() => {});
    return Response.json({ ok: false, error: "bad_code" }, { status: 401 });
  }
  await recordAdminAction("login", user.name, `from ${maskIp(clientIp(req))}`, user.name).catch(() => {});
  return Response.json({ ok: true, me: { name: user.name, role: user.role } }, { headers: { "set-cookie": adminCookieFor(user, isHttps(req)) } });
}

export async function DELETE(req: Request) {
  return Response.json({ ok: true }, { headers: { "set-cookie": clearAdminCookie(isHttps(req)) } });
}
