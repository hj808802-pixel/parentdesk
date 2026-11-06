import { acceptInvite, addMemberKey, familyCookie, isHttps, loadFamily, parseFamilyKey, parseInviteToken, saveFamily, toView, verifySecret } from "@/lib/store";
import { allowRequest, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Switches this browser to another family: with the family key pasted from a partner's
// phone ({ key }), or with an invite link's token ({ invite }). The server stores only
// hashes, so an invite cannot repeat the first key; the joining device gets a member key
// of its own (same format, same powers) which the browser keeps like any key.

export async function POST(req: Request) {
  const gate = allowRequest({ ip: clientIp(req), family: null });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason }, { status: 429 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (body && "invite" in body) {
    const parsed = parseInviteToken(body.invite);
    if (!parsed) return Response.json({ ok: false, error: "bad_invite" }, { status: 400 });
    const rec = await loadFamily(parsed.id);
    if (!rec || !acceptInvite(rec, parsed.secret)) return Response.json({ ok: false, error: "bad_invite" }, { status: 404 });
    const key = addMemberKey(rec);
    await saveFamily(rec);
    return Response.json({ ok: true, family: toView(rec), key }, { headers: { "set-cookie": familyCookie(key, isHttps(req)) } });
  }

  const parsed = parseFamilyKey(body?.key);
  if (!parsed) return Response.json({ ok: false, error: "bad_key" }, { status: 400 });
  const rec = await loadFamily(parsed.id);
  if (!rec || !verifySecret(rec, parsed.secret)) return Response.json({ ok: false, error: "bad_key" }, { status: 404 });
  return Response.json({ ok: true, family: toView(rec) }, { headers: { "set-cookie": familyCookie(`pd_${parsed.id}_${parsed.secret}`, isHttps(req)) } });
}
