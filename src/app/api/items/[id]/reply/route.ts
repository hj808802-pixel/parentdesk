import { modelErrorResponse } from "@/lib/apierror";
import { draftReply, REPLY_INTENTS, type ReplyIntent } from "@/lib/assist";
import { todayIn } from "@/lib/dates";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { familyFromRequest } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

// Drafts a message to the school about one item, in the notice's language, with a
// translation in the family's language. Nothing is sent or stored.

export async function POST(req: Request, { params }: Params) {
  const rec = await familyFromRequest(req);
  if (!rec) return Response.json({ ok: false, error: "no_family" }, { status: 404 });
  const { id } = await params;
  const item = rec.items.find((it) => it.id === id);
  if (!item) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  const gate = allowRequest({ ip: clientIp(req), family: rec.id });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason, retry_after: gate.retryAfterSec }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } });

  const body = (await req.json().catch(() => null)) as { intent?: unknown; note?: unknown } | null;
  const intent = (REPLY_INTENTS as string[]).includes(String(body?.intent)) ? (body!.intent as ReplyIntent) : "question";
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 600) : "";
  if (intent === "custom" && note.length < 3) return Response.json({ ok: false, error: "text_too_short" }, { status: 400 });

  const source = rec.sources.find((s) => s.id === item.sourceId) ?? null;
  try {
    const out = await draftReply(rec, item, source, intent, note, todayIn(rec.settings.timezone));
    console.log(JSON.stringify({ event: "reply", family: rec.id, intent, model: out.model, mock: out.mock }));
    return Response.json({ ok: true, ...out.result, mock: out.mock });
  } catch (e) {
    return modelErrorResponse(e, "reply");
  }
}
