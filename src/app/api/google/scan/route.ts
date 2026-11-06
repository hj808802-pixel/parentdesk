import { gmailEnabled, scanFamily } from "@/lib/gmail";
import { canUse } from "@/lib/plan";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { bumpCounter, familyFromRequest, saveFamily, toView } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// "Check now": one scan of the connected inbox for this family.

export async function POST(req: Request) {
  if (!gmailEnabled()) return Response.json({ ok: false, error: "gmail_off" }, { status: 404 });
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  if (!rec.gmail) return Response.json({ ok: false, error: "not_connected" }, { status: 400 });
  if (!canUse(rec, "gmail")) return Response.json({ ok: false, error: "plan_limit" }, { status: 402 });
  const gate = allowRequest({ ip: clientIp(req), family: rec.id });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason, retry_after: gate.retryAfterSec }, { status: 429 });

  rec.gmail.paused = false;
  const result = await scanFamily(rec, { budgetMs: 48_000 });
  bumpCounter(rec, "gmail_scan");
  await saveFamily(rec);
  console.log(JSON.stringify({ event: "gmail_scan", family: rec.id, ...result }));
  return Response.json({ ok: true, result, family: toView(rec) });
}
