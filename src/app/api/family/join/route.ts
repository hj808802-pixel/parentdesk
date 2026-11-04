import { familyCookie, isHttps, loadFamily, parseFamilyKey, toView, verifySecret } from "@/lib/store";
import { allowRequest, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Switches this browser to the family whose key was pasted (from a partner's phone).

export async function POST(req: Request) {
  const gate = allowRequest({ ip: clientIp(req), family: null });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason }, { status: 429 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseFamilyKey(body?.key);
  if (!parsed) return Response.json({ ok: false, error: "bad_key" }, { status: 400 });
  const rec = await loadFamily(parsed.id);
  if (!rec || !verifySecret(rec, parsed.secret)) return Response.json({ ok: false, error: "bad_key" }, { status: 404 });
  return Response.json({ ok: true, family: toView(rec) }, { headers: { "set-cookie": familyCookie(`pd_${parsed.id}_${parsed.secret}`, isHttps(req)) } });
}
