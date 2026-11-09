import { modelErrorResponse } from "@/lib/apierror";
import { explainItem } from "@/lib/assist";
import { todayIn } from "@/lib/dates";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { bumpCounter, familyFromRequest, saveFamily } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// One item explained in plain words, in the family's language, with the steps to take and
// the local background a newcomer would not know. Nothing is stored.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  const { id } = await params;
  const item = rec.items.find((it) => it.id === id);
  if (!item) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const gate = allowRequest({ ip: clientIp(req), family: rec.id });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason, retry_after: gate.retryAfterSec }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } });

  const source = rec.sources.find((s) => s.id === item.sourceId) ?? null;
  const started = Date.now();
  try {
    const out = await explainItem(rec, item, source, todayIn(rec.settings.timezone));
    bumpCounter(rec, "explain");
    await saveFamily(rec);
    console.log(JSON.stringify({ event: "explain", family: rec.id, type: item.type, ms: Date.now() - started, model: out.model, mock: out.mock }));
    return Response.json({ ok: true, ...out.result, mock: out.mock });
  } catch (e) {
    return modelErrorResponse(e, "explain");
  }
}
