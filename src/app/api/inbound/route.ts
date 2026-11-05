import { timingSafeEqual } from "node:crypto";
import { contextOf, extractNotice, ExtractError, type ImageMediaType, type InputFile } from "@/lib/extract";
import { htmlToText } from "@/lib/html";
import { allowRequest, clientIp } from "@/lib/ratelimit";
import { addExtraction, loadFamily, parseInboundAddress, saveFamily } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

// E-mail forwarding. A mail router (Cloudflare Email Routing worker, Resend or Postmark
// inbound) POSTs the message here as JSON:
//   { to, from, subject, text, html?, attachments?: [{ filename, contentType, content }] }
// with "Authorization: Bearer <INBOUND_SECRET>". The family comes from the address:
// <familyId>-<inboundCode>@<INBOUND_DOMAIN>. Off until INBOUND_SECRET is set.

const IMAGE_TYPES = new Set<string>(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CHARS = 20000;

function authorized(req: Request): boolean {
  const secret = process.env.INBOUND_SECRET ?? "";
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export { htmlToText } from "@/lib/html";

type Attachment = { filename?: string; contentType?: string; content?: string };

export async function POST(req: Request) {
  if (!process.env.INBOUND_SECRET) return Response.json({ ok: false, error: "inbound_off" }, { status: 404 });
  if (!authorized(req)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });

  const addr = parseInboundAddress(body.to) ?? parseInboundAddress(Array.isArray(body.to) ? String(body.to[0] ?? "") : "");
  if (!addr) return Response.json({ ok: false, error: "unknown_address" }, { status: 404 });
  const rec = await loadFamily(addr.id);
  if (!rec || rec.inboundCode !== addr.code) return Response.json({ ok: false, error: "unknown_address" }, { status: 404 });

  const gate = allowRequest({ ip: clientIp(req), family: rec.id });
  if (!gate.ok) return Response.json({ ok: false, error: gate.reason }, { status: 429 });

  const subject = typeof body.subject === "string" ? body.subject.slice(0, 300) : "";
  const from = typeof body.from === "string" ? body.from.slice(0, 200) : "";
  let text = typeof body.text === "string" && body.text.trim() ? body.text : typeof body.html === "string" ? htmlToText(body.html) : "";
  text = text.slice(0, MAX_TEXT_CHARS);

  const inputs: InputFile[] = [];
  const header = [subject ? `Subject: ${subject}` : "", from ? `From: ${from}` : ""].filter(Boolean).join("\n");
  if (text.trim() || header) inputs.push({ kind: "text", text: `${header}\n\n${text}`.trim() });

  const attachments = Array.isArray(body.attachments) ? (body.attachments as Attachment[]).slice(0, MAX_ATTACHMENTS) : [];
  for (const a of attachments) {
    if (!a || typeof a.content !== "string") continue;
    const bytes = Math.floor((a.content.length * 3) / 4);
    if (bytes > MAX_ATTACHMENT_BYTES) continue;
    const type = (a.contentType ?? "").split(";")[0].trim().toLowerCase();
    if (type === "application/pdf") inputs.push({ kind: "pdf", base64: a.content });
    else if (IMAGE_TYPES.has(type)) inputs.push({ kind: "image", mediaType: type as ImageMediaType, base64: a.content });
  }
  if (inputs.length === 0) return Response.json({ ok: false, error: "empty" }, { status: 400 });

  try {
    const out = await extractNotice(inputs, contextOf(rec));
    let count = 0;
    let skipped = 0;
    if (out.result.is_school_related && out.result.items.length > 0) {
      const added = addExtraction(rec, out.result, "email", inputs.length);
      count = added.items.length;
      skipped = added.skipped;
    }
    await saveFamily(rec);
    console.log(JSON.stringify({ event: "inbound", family: rec.id, items: count, skipped, school_related: out.result.is_school_related, model: out.model, usage: out.usage ?? null }));
    return Response.json({ ok: true, saved: count > 0, items: count, skipped });
  } catch (e) {
    if (e instanceof ExtractError) return Response.json({ ok: false, error: e.code }, { status: 422 });
    console.error("[inbound]", e);
    return Response.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
