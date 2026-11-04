import Anthropic from "@anthropic-ai/sdk";
import { extractNotice, ExtractError, type ImageMediaType, type InputFile } from "@/lib/extract";
import { todayIn } from "@/lib/dates";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { sampleNotice } from "@/lib/sample";
import { addExtraction, createFamily, familyCookie, familyFromRequest, isHttps, saveFamily, toView, type SourceKind } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

const IMAGE_TYPES = new Set<string>(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const MAX_FILES = 5;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4.3 * 1024 * 1024; // Vercel request body limit is 4.5 MB
const MIN_TEXT_CHARS = 15;
const MAX_TEXT_CHARS = 20000;

// One notice in (files, pasted text or the bundled sample), items out and saved.
// A browser without a family gets one created here, so the first upload needs no setup.

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  let rec = await familyFromRequest(req);

  const gate = allowRequest({ ip: clientIp(req), family: rec?.id ?? null });
  if (!gate.ok) {
    return Response.json({ ok: false, error: gate.reason, request_id: requestId, retry_after: gate.retryAfterSec }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "bad_form", request_id: requestId }, { status: 400 });
  }

  const useSample = form.get("sample") === "1";
  const files = useSample ? [] : form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const pastedText = useSample ? "" : String(form.get("text") ?? "").trim();

  if (!useSample) {
    if (files.length === 0 && !pastedText) return Response.json({ ok: false, error: "no_files", request_id: requestId }, { status: 400 });
    if (files.length === 0 && pastedText.length < MIN_TEXT_CHARS) return Response.json({ ok: false, error: "text_too_short", request_id: requestId }, { status: 400 });
    if (files.length === 0 && pastedText.length > MAX_TEXT_CHARS) return Response.json({ ok: false, error: "too_large", request_id: requestId }, { status: 413 });
    if (files.length > MAX_FILES) return Response.json({ ok: false, error: "too_many_files", request_id: requestId }, { status: 400 });
  }

  const inputs: InputFile[] = [];
  let total = 0;
  for (const f of files) {
    total += f.size;
    if (f.size > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) return Response.json({ ok: false, error: "too_large", request_id: requestId }, { status: 413 });
    const base64 = Buffer.from(await f.arrayBuffer()).toString("base64");
    if (f.type === "application/pdf") inputs.push({ kind: "pdf", base64 });
    else if (IMAGE_TYPES.has(f.type)) inputs.push({ kind: "image", mediaType: f.type as ImageMediaType, base64 });
    else return Response.json({ ok: false, error: "unsupported_type", request_id: requestId }, { status: 400 });
  }
  // First notice ever on this browser: make the family now, from the UI locale and the
  // browser's time zone, so the dates are read the right way from the start.
  const headers = new Headers();
  let createdKey: string | undefined;
  if (!rec) {
    const created = createFamily({
      locale: String(form.get("locale") ?? "") || null,
      timezone: String(form.get("timezone") ?? "") || null,
    });
    rec = created.record;
    createdKey = created.key;
    headers.append("set-cookie", familyCookie(created.key, isHttps(req)));
  }

  // The sample is written for the family's "today", so its weekdays and dates agree.
  if (useSample) inputs.push({ kind: "text", text: sampleNotice(todayIn(rec.settings.timezone)) });
  else if (files.length === 0) inputs.push({ kind: "text", text: pastedText });

  const hintChildId = String(form.get("child") ?? "") || null;
  const hintChild = hintChildId ? rec.children.find((c) => c.id === hintChildId) : undefined;
  const kind: SourceKind = useSample ? "sample" : files.length ? "upload" : "paste";
  const started = Date.now();

  try {
    const out = await extractNotice(inputs, {
      language: rec.settings.language,
      country: rec.settings.country,
      timezone: rec.settings.timezone,
      dateOrder: rec.settings.dateOrder,
      currency: rec.settings.currency,
      weekStart: rec.settings.weekStart,
      childNames: rec.children.map((c) => c.name),
      todayIso: todayIn(rec.settings.timezone),
      hintChildName: hintChild?.name ?? null,
    });

    const saved = out.result.is_school_related && out.result.items.length > 0;
    let source = null;
    let items: unknown[] = [];
    if (saved) {
      const added = addExtraction(rec, out.result, kind, inputs.length, hintChild?.id ?? null);
      source = added.source;
      items = added.items;
    }
    await saveFamily(rec);

    console.log(
      JSON.stringify({
        event: "extract",
        request_id: requestId,
        family: rec.id,
        kind,
        pages: inputs.length,
        language: rec.settings.language,
        country: rec.settings.country,
        items: out.result.items.length,
        school_related: out.result.is_school_related,
        ms: Date.now() - started,
        model: out.model,
        usage: out.usage ?? null,
        mock: out.mock,
      }),
    );

    return Response.json(
      {
        ok: true,
        request_id: requestId,
        saved,
        source,
        items,
        summary: out.result.source.summary,
        questions: out.result.questions_for_parent,
        school_related: out.result.is_school_related,
        family: toView(rec),
        mock: out.mock,
        // Only on the request that created the family: the browser keeps it so the parent
        // can show and share it from Settings. The server stores a hash and cannot repeat it.
        key: createdKey,
      },
      { headers },
    );
  } catch (e) {
    const fail = (code: string, status: number, extra: Record<string, unknown> = {}) => Response.json({ ok: false, error: code, request_id: requestId, ...extra }, { status, headers });
    if (e instanceof ExtractError) {
      console.warn("[extract]", requestId, e.code, e.message);
      return fail(e.code, 422);
    }
    if (e instanceof Anthropic.AuthenticationError) {
      console.error("[extract] authentication failed: check ANTHROPIC_API_KEY");
      return fail("server_not_configured", 500);
    }
    if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.APIConnectionError) {
      console.error("[extract] upstream unavailable", e.message);
      return fail("upstream_unavailable", 503);
    }
    if (e instanceof Anthropic.APIError) {
      console.error("[extract] upstream error", e.status, e.message);
      return fail("upstream_error", 502, { message: e.message });
    }
    console.error("[extract] unexpected", e);
    return fail("internal", 500);
  }
}
