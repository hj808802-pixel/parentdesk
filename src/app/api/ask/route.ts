import { modelErrorResponse } from "@/lib/apierror";
import { isPaused } from "@/lib/ops";
import { askAssistant } from "@/lib/assist";
import { todayIn } from "@/lib/dates";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { bumpCounter, familyFromRequest, saveFamily } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// "What do I need to pay this month?" answered from the family's saved items only.
// Stateless: nothing about the question is stored.

export async function POST(req: Request) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  if (await isPaused(rec.id)) return Response.json({ ok: false, error: "blocked" }, { status: 403 });
  const gate = allowRequest({ ip: clientIp(req), family: rec.id });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason, retry_after: gate.retryAfterSec }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } });

  const body = (await req.json().catch(() => null)) as { question?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, 500) : "";
  if (question.length < 2) return Response.json({ ok: false, error: "text_too_short" }, { status: 400 });

  const started = Date.now();
  try {
    const out = await askAssistant(rec, question, todayIn(rec.settings.timezone));
    const ids = new Set(out.result.item_ids);
    const items = rec.items.filter((it) => ids.has(it.id));
    bumpCounter(rec, "ask");
    await saveFamily(rec);
    console.log(JSON.stringify({ event: "ask", family: rec.id, chars: question.length, items: items.length, ms: Date.now() - started, model: out.model, mock: out.mock }));
    return Response.json({ ok: true, answer: out.result.answer, items, mock: out.mock });
  } catch (e) {
    return modelErrorResponse(e, "ask");
  }
}
