import { randomBytes } from "node:crypto";
import { classifyEmails, type MailHead as ClassifyHead } from "./assist";
import { cryptoReady, decrypt, sign, verifySignature } from "./crypto";
import { todayIn } from "./dates";
import { contextOf, extractNotice, type ImageMediaType, type InputFile } from "./extract";
import { htmlToText } from "./html";
import { canExtract } from "./plan";
import { addExtraction } from "./store";
import type { FamilyRecord, GmailLink } from "./types";

// Gmail auto-collect. The parent connects Gmail once (read-only scope). A daily cron and
// the "Check now" button then list recent mail, keep the messages that come from the
// school (trusted senders first, the rest sorted by the classifier model), run the
// extractor on those and add the items. Only message ids, the trusted sender addresses
// and the sealed refresh token are stored.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
export const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"];

const MAX_LIST = 40;
const MAX_EXTRACT_PER_SCAN = 8;
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CHARS = 20000;
const MAX_PROCESSED = 600;
const MAX_SENDERS = 60;
const IMAGE_TYPES = new Set<string>(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export class GmailError extends Error {
  constructor(
    public code: "not_configured" | "oauth" | "reconnect" | "api",
    message: string,
  ) {
    super(message);
  }
}

export function gmailEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) && cryptoReady();
}

export function redirectUri(origin: string): string {
  return `${origin}/api/google/callback`;
}

// ---- OAuth ----

export function newState(familyId: string): string {
  const nonce = randomBytes(8).toString("hex");
  const body = `${familyId}.${nonce}`;
  return `${body}.${sign(body)}`;
}

export function parseState(state: unknown): { familyId: string } | null {
  if (typeof state !== "string") return null;
  const m = /^([0-9a-f]{12})\.([0-9a-f]{16})\.([A-Za-z0-9_-]+)$/.exec(state);
  if (!m) return null;
  return verifySignature(`${m[1]}.${m[2]}`, m[3]) ? { familyId: m[1] } : null;
}

export function authUrl(origin: string, state: string): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID ?? "");
  u.searchParams.set("redirect_uri", redirectUri(origin));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

type TokenResponse = { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number; error?: string; error_description?: string };

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", ...params }),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) {
    const code = body.error === "invalid_grant" ? "reconnect" : "oauth";
    throw new GmailError(code, `${res.status} ${body.error ?? ""} ${body.error_description ?? ""}`.trim());
  }
  return body;
}

export async function exchangeCode(code: string, origin: string): Promise<{ accessToken: string; refreshToken: string | null; email: string | null }> {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(origin) });
  if (!t.access_token) throw new GmailError("oauth", "no access token");
  return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, email: t.id_token ? emailFromIdToken(t.id_token) : null };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const t = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
  if (!t.access_token) throw new GmailError("oauth", "no access token");
  return t.access_token;
}

// The id_token came straight from Google's token endpoint over TLS, so its payload can
// be read without verifying the signature.
export function emailFromIdToken(idToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: string };
    return typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function fetchEmail(accessToken: string): Promise<string | null> {
  const res = await fetch(`${API}/profile`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { emailAddress?: string };
  return body.emailAddress?.toLowerCase() ?? null;
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => undefined);
}

// ---- Gmail API ----

async function api<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (res.status === 401) throw new GmailError("reconnect", "unauthorized");
  if (!res.ok) throw new GmailError("api", `${res.status} ${path}`);
  return (await res.json()) as T;
}

export function searchQuery(days: number): string {
  return `newer_than:${days}d -category:promotions -category:social -in:spam -in:trash -in:sent -in:draft`;
}

export async function listMessageIds(accessToken: string, q: string, max = MAX_LIST): Promise<string[]> {
  const body = await api<{ messages?: { id: string }[] }>(accessToken, `/messages?q=${encodeURIComponent(q)}&maxResults=${max}`);
  return (body.messages ?? []).map((m) => m.id);
}

export type Part = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: Part[];
};
export type Message = { id: string; snippet?: string; internalDate?: string; payload?: Part };

export async function getMessage(accessToken: string, id: string, format: "metadata" | "full"): Promise<Message> {
  const extra = format === "metadata" ? "&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date" : "";
  return api<Message>(accessToken, `/messages/${id}?format=${format}${extra}`);
}

export async function getAttachment(accessToken: string, messageId: string, attachmentId: string): Promise<string> {
  const body = await api<{ data?: string }>(accessToken, `/messages/${messageId}/attachments/${attachmentId}`);
  return toStandardBase64(body.data ?? "");
}

export function toStandardBase64(urlSafe: string): string {
  const s = urlSafe.replace(/-/g, "+").replace(/_/g, "/");
  return s + "=".repeat((4 - (s.length % 4)) % 4);
}

function decodeBody(data: string | undefined): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

export function header(msg: Message, name: string): string {
  const h = msg.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

export type Head = { id: string; from: string; subject: string; date: string; snippet: string };

export function headOf(msg: Message): Head {
  return { id: msg.id, from: header(msg, "From"), subject: header(msg, "Subject"), date: header(msg, "Date"), snippet: msg.snippet ?? "" };
}

export type ParsedPayload = { text: string; html: string; attachments: { attachmentId: string; mimeType: string; filename: string; size: number }[] };

export function parsePayload(payload: Part | undefined): ParsedPayload {
  const out: ParsedPayload = { text: "", html: "", attachments: [] };
  const walk = (p: Part | undefined) => {
    if (!p) return;
    if (p.parts?.length) {
      for (const c of p.parts) walk(c);
      return;
    }
    const type = (p.mimeType ?? "").toLowerCase();
    if (p.body?.attachmentId && (p.filename || !type.startsWith("text/"))) {
      out.attachments.push({ attachmentId: p.body.attachmentId, mimeType: type, filename: p.filename ?? "", size: p.body.size ?? 0 });
      return;
    }
    if (type === "text/plain") out.text += decodeBody(p.body?.data) + "\n";
    else if (type === "text/html") out.html += decodeBody(p.body?.data);
  };
  walk(payload);
  out.text = out.text.trim();
  return out;
}

// "Ms Rivera <rivera@oakstreet.k12.ca.us>" -> "rivera@oakstreet.k12.ca.us"
export function senderAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim().toLowerCase();
}

// Used only in demo mode (no model) and as a tie-breaker in tests.
const SCHOOL_HINTS = [
  ".edu", ".k12.", ".sc.kr", ".es.kr", ".ms.kr", ".hs.kr", ".kg.kr", ".ed.jp", ".ac.jp", ".sch.uk", ".edu.au", ".edu.sg", ".edu.hk",
  "school", "schule", "ecole", "école", "colegio", "escuela", "scuola", "kita", "nursery", "preschool", "daycare", "childcare", "kindergarten",
  "classdojo", "remind.com", "parentsquare", "bloomz", "seesaw", "classting", "iamschool", "kidsnote", "hiclass", "brightwheel", "procare", "tadpoles",
  "schoology", "powerschool", "skyward", "infinitecampus", "aeries", "myschoolbucks", "schoolmessenger", "konstella", "classlist", "parentmail", "parentpay", "arbor", "weduc",
  "pta", "학교", "학부모", "가정통신문", "담임", "선생님", "유치원", "어린이집", "학원", "체험학습", "알림장", "学校", "保護者", "先生", "幼稚園", "保育園", "家长", "老师", "幼儿园",
  "teacher", "class", "field trip", "permission", "homework", "newsletter", "parent", "camp", "eltern", "lehrer", "enseignant", "maestr", "profesor",
];

export function looksLikeSchool(h: ClassifyHead): boolean {
  const hay = `${h.from} ${h.subject} ${h.snippet}`.toLowerCase();
  return SCHOOL_HINTS.some((k) => hay.includes(k));
}

// ---- the scan ----

export type ScanResult = NonNullable<GmailLink["lastResult"]>;

async function mapLimit<T, R>(xs: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, xs.length) }, async () => {
    while (next < xs.length) {
      const i = next++;
      out[i] = await fn(xs[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function scanFamily(rec: FamilyRecord, opts: { budgetMs?: number; maxExtract?: number; now?: Date } = {}): Promise<ScanResult> {
  const g = rec.gmail;
  if (!g) throw new GmailError("not_configured", "no gmail link");
  const now = opts.now ?? new Date();
  const deadline = Date.now() + (opts.budgetMs ?? 50_000);
  const maxExtract = opts.maxExtract ?? MAX_EXTRACT_PER_SCAN;
  const finish = (r: ScanResult) => {
    g.lastScanAt = now.toISOString();
    g.lastResult = r;
    return r;
  };

  let access: string;
  try {
    access = await refreshAccessToken(decrypt(g.refreshToken));
  } catch (e) {
    g.paused = true;
    return finish({ scanned: 0, picked: 0, added: 0, skipped: 0, error: e instanceof GmailError ? e.code : "api" });
  }

  const empty: ScanResult = { scanned: 0, picked: 0, added: 0, skipped: 0 };
  try {
    const days = g.lastScanAt ? 7 : 14;
    const processed = new Set(g.processed);
    const ids = (await listMessageIds(access, searchQuery(days))).filter((id) => !processed.has(id));
    if (ids.length === 0) return finish(empty);

    const heads = await mapLimit(ids, 6, (id) => getMessage(access, id, "metadata").then(headOf));
    const trusted = new Set(g.senders);
    const picked: Head[] = [];
    const unknown: Head[] = [];
    for (const h of heads) (trusted.has(senderAddress(h.from)) ? picked : unknown).push(h);
    if (unknown.length) {
      const { picked: idx } = await classifyEmails(unknown, looksLikeSchool);
      for (const i of idx) picked.push(unknown[i]);
    }

    const pickedIds = new Set(picked.map((h) => h.id));
    const done: string[] = heads.filter((h) => !pickedIds.has(h.id)).map((h) => h.id);
    let added = 0;
    let skipped = 0;
    let extracted = 0;
    const todayIso = todayIn(rec.settings.timezone, now);
    for (const h of picked) {
      if (extracted >= maxExtract || Date.now() > deadline) break; // the rest waits for the next run
      if (!canExtract(rec, todayIso.slice(0, 7)).ok) break; // free plan used up this month
      const full = await getMessage(access, h.id, "full");
      const parsed = parsePayload(full.payload);
      const body = (parsed.text || htmlToText(parsed.html)).slice(0, MAX_TEXT_CHARS);
      const inputs: InputFile[] = [{ kind: "text", text: `Subject: ${h.subject}\nFrom: ${h.from}\nDate: ${h.date}\n\n${body}`.trim() }];
      for (const a of parsed.attachments.slice(0, MAX_ATTACHMENTS)) {
        if (a.size > MAX_ATTACHMENT_BYTES) continue;
        if (a.mimeType === "application/pdf") inputs.push({ kind: "pdf", base64: await getAttachment(access, h.id, a.attachmentId) });
        else if (IMAGE_TYPES.has(a.mimeType)) inputs.push({ kind: "image", mediaType: a.mimeType as ImageMediaType, base64: await getAttachment(access, h.id, a.attachmentId) });
      }
      const out = await extractNotice(inputs, contextOf(rec, null, todayIso));
      extracted++;
      done.push(h.id);
      if (out.result.is_school_related && out.result.items.length > 0) {
        const r = addExtraction(rec, out.result, "gmail", inputs.length);
        added += r.items.length;
        skipped += r.skipped;
        const addr = senderAddress(h.from);
        if (addr && !g.senders.includes(addr)) g.senders = [addr, ...g.senders].slice(0, MAX_SENDERS);
      }
    }
    g.processed = [...done, ...g.processed].slice(0, MAX_PROCESSED);
    return finish({ scanned: heads.length, picked: picked.length, added, skipped });
  } catch (e) {
    const code = e instanceof GmailError ? e.code : "api";
    if (code === "reconnect") g.paused = true;
    console.error("[gmail] scan failed", rec.id, e);
    return finish({ ...empty, error: code });
  }
}
