import { contextOf, extractNotice, type ImageMediaType, type InputFile } from "@/lib/extract";
import { localePath } from "@/lib/i18n/locales";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { localeOf, redirectTo } from "@/lib/request";
import { addExtraction, createFamily, familyCookie, familyFromRequest, isHttps, saveFamily } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// Web Share Target (Android, installed app): the system "Share" sheet POSTs a title, text,
// a link or files here. The content is extracted right away and the browser lands on the
// Add page showing what was saved: ?shared=<source id>, or shared=none (not a notice),
// shared=dup (everything was already on the list), shared=error.

const IMAGE_TYPES = new Set<string>(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_FILES = 5;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CHARS = 20000;

export async function GET(req: Request) {
  return redirectTo(req, localePath(localeOf(req), "/add"));
}

export async function POST(req: Request) {
  const locale = localeOf(req);
  const back = (query: string, headers: Record<string, string> = {}, fragment = "") => redirectTo(req, `${localePath(locale, "/add")}?${query}${fragment}`, headers);

  let rec = await familyFromRequest(req);
  const gate = allowRequest({ ip: clientIp(req), family: rec?.id ?? null });
  if (!gate.ok) return back("shared=error&reason=rate_limited");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return back("shared=error");
  }
  const title = String(form.get("title") ?? "").trim().slice(0, 300);
  const text = String(form.get("text") ?? "").trim().slice(0, MAX_TEXT_CHARS);
  const link = String(form.get("url") ?? "").trim().slice(0, 2000);
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0).slice(0, MAX_FILES);

  const inputs: InputFile[] = [];
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) continue;
    const base64 = Buffer.from(await f.arrayBuffer()).toString("base64");
    if (f.type === "application/pdf") inputs.push({ kind: "pdf", base64 });
    else if (IMAGE_TYPES.has(f.type)) inputs.push({ kind: "image", mediaType: f.type as ImageMediaType, base64 });
  }
  const textBlock = [title ? `Title: ${title}` : "", text, link ? `Link: ${link}` : ""].filter(Boolean).join("\n\n");
  if (textBlock && (inputs.length === 0 || textBlock.length >= 15)) inputs.push({ kind: "text", text: textBlock });
  if (inputs.length === 0) return back("shared=error&reason=empty");

  const headers: Record<string, string> = {};
  let fragment = "";
  if (!rec) {
    const created = createFamily({ locale });
    rec = created.record;
    headers["set-cookie"] = familyCookie(created.key, isHttps(req));
    // The Add page keeps the key in local storage (see AddNotice) and drops it from the URL.
    fragment = `#key=${created.key}`;
  }

  const started = Date.now();
  try {
    const out = await extractNotice(inputs, contextOf(rec));
    let query = "shared=none";
    let items = 0;
    let skipped = 0;
    if (out.result.is_school_related && out.result.items.length > 0) {
      const added = addExtraction(rec, out.result, "share", inputs.length);
      items = added.items.length;
      skipped = added.skipped;
      query = items > 0 ? `shared=${added.source.id}` : "shared=dup";
    }
    await saveFamily(rec);
    console.log(JSON.stringify({ event: "share", family: rec.id, pages: inputs.length, items, skipped, school_related: out.result.is_school_related, ms: Date.now() - started, model: out.model, usage: out.usage ?? null }));
    return back(query, headers, fragment);
  } catch (e) {
    console.error("[share]", e);
    if (headers["set-cookie"]) await saveFamily(rec).catch(() => undefined);
    return back("shared=error", headers, fragment);
  }
}
