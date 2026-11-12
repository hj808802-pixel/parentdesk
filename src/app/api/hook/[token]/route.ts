import { modelErrorResponse } from "@/lib/apierror";
import { isPaused } from "@/lib/ops";
import { classifyEmails } from "@/lib/assist";
import { todayIn } from "@/lib/dates";
import { contextOf, extractNotice, type InputFile } from "@/lib/extract";
import { canExtract } from "@/lib/plan";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { addExtraction, bumpCounter, loadFamily, parseHookToken, saveFamily, verifyHookSecret } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// The device-automation address. An iPhone Shortcut automation or an Android automation
// app (MacroDroid, Tasker) POSTs a message here as it arrives on the phone:
//   JSON { text, title?, from?, ping? }, a form with the same fields, or plain text.
// The cheap classifier drops what is not from a school; the rest is extracted like a pasted
// notice. { ping: true } only proves the address works. No cookie: the token is the key.

const MIN_TEXT_CHARS = 10;
const MAX_TEXT_CHARS = 20000;

const str = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");

async function readBody(req: Request): Promise<{ text: string; title: string; from: string; ping: boolean }> {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b || typeof b !== "object") return { text: "", title: "", from: "", ping: false };
    return { text: str(b.text ?? b.message ?? b.body ?? b.content, MAX_TEXT_CHARS + 1), title: str(b.title ?? b.subject, 300), from: str(b.from ?? b.sender ?? b.app, 200), ping: b.ping === true };
  }
  if (ct.includes("form")) {
    const f = await req.formData().catch(() => null);
    return { text: str(f?.get("text") ?? f?.get("message"), MAX_TEXT_CHARS + 1), title: str(f?.get("title") ?? f?.get("subject"), 300), from: str(f?.get("from") ?? f?.get("sender"), 200), ping: f?.get("ping") === "true" };
  }
  return { text: str(await req.text().catch(() => ""), MAX_TEXT_CHARS + 1), title: "", from: "", ping: false };
}

export async function GET() {
  return Response.json({ ok: false, error: "use_post" }, { status: 405, headers: { allow: "POST" } });
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = parseHookToken(token);
  if (!parsed) return Response.json({ ok: false, error: "bad_token" }, { status: 404 });
  const rec = await loadFamily(parsed.id);
  if (!rec || !verifyHookSecret(rec, parsed.secret)) return Response.json({ ok: false, error: "bad_token" }, { status: 404 });
  if (await isPaused(rec.id)) return Response.json({ ok: false, error: "blocked" }, { status: 403 });

  const gate = allowRequest({ ip: clientIp(req), family: rec.id });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason, retry_after: gate.retryAfterSec }, { status: 429 });

  const body = await readBody(req);
  if (body.ping) return Response.json({ ok: true, ping: true });
  if (body.text.length < MIN_TEXT_CHARS) return Response.json({ ok: false, error: "text_too_short" }, { status: 400 });
  if (body.text.length > MAX_TEXT_CHARS) return Response.json({ ok: false, error: "too_large" }, { status: 413 });
  const plan = canExtract(rec, todayIn(rec.settings.timezone).slice(0, 7));
  if (!plan.ok) return Response.json({ ok: false, error: plan.reason, used: plan.used, limit: plan.limit }, { status: 402 });

  const started = Date.now();
  try {
    // A phone forwards everything it is told to; keep only what looks like a school message.
    const picked = await classifyEmails([{ from: body.from || "(device)", subject: body.title || body.text.slice(0, 80), snippet: body.text.slice(0, 300) }], () => true);
    if (picked.picked.length === 0) {
      console.log(JSON.stringify({ event: "hook", family: rec.id, saved: false, reason: "not_school", chars: body.text.length, ms: Date.now() - started, model: picked.model }));
      return Response.json({ ok: true, saved: false, reason: "not_school" });
    }
    const header = [body.title ? `Title: ${body.title}` : "", body.from ? `From: ${body.from}` : ""].filter(Boolean).join("\n");
    const inputs: InputFile[] = [{ kind: "text", text: `${header}\n\n${body.text}`.trim() }];
    const out = await extractNotice(inputs, contextOf(rec));
    let items = 0;
    let skipped = 0;
    if (out.result.is_school_related && out.result.items.length > 0) {
      const added = addExtraction(rec, out.result, "hook", 1);
      items = added.items.length;
      skipped = added.skipped;
    }
    bumpCounter(rec, "hook");
    await saveFamily(rec);
    console.log(JSON.stringify({ event: "hook", family: rec.id, saved: items > 0, items, skipped, school_related: out.result.is_school_related, chars: body.text.length, ms: Date.now() - started, model: out.model, usage: out.usage ?? null, mock: out.mock }));
    return Response.json({ ok: true, saved: items > 0, items, skipped, school_related: out.result.is_school_related, reason: out.result.is_school_related ? (items > 0 ? "saved" : "nothing_new") : "not_school" });
  } catch (e) {
    return modelErrorResponse(e, "hook");
  }
}
