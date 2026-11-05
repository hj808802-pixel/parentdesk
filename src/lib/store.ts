import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { del, get, list, put } from "@vercel/blob";
import { countryOf, guessCountry, isCountry, isTimezone } from "./countries";
import { cryptoReady } from "./crypto";
import { findDuplicate } from "./dedupe";
import { isHhMm, isIsoDate } from "./dates";
import { ITEM_TYPES, isOutputLanguage, type Extraction, type ItemType } from "./schema";
import { CHILD_COLORS, MAX_CHILDREN, type Child, type FamilyRecord, type FamilyView, type Features, type Item, type Settings, type Source, type SourceKind } from "./types";

export * from "./types";

// One family = one JSON document. No accounts: the family key (id + secret) lives in an
// HttpOnly cookie and can be pasted on a partner's phone. Storage is Vercel Blob in
// production, a folder in development, memory in tests.
//
// What is stored: settings, children (name and colour only), the notices' summaries and
// the extracted items. Uploaded photos and PDFs are never stored.

export const FAMILY_COOKIE = "pd_family";
const PREFIX = "parentdesk/families/";
const MAX_ITEMS = 2000;
const MAX_SOURCES = 400;

export function newId(bytes = 6): string {
  return randomBytes(bytes).toString("hex");
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

// ---- keys, tokens, addresses ----

export function makeFamilyKey(id: string, secret: string): string {
  return `pd_${id}_${secret}`;
}

export function parseFamilyKey(key: unknown): { id: string; secret: string } | null {
  if (typeof key !== "string") return null;
  const m = /^pd_([0-9a-f]{12})_([0-9a-f]{24})$/.exec(key.trim());
  return m ? { id: m[1], secret: m[2] } : null;
}

export function feedTokenOf(rec: Pick<FamilyRecord, "id" | "feedSecret">): string {
  return `${rec.id}_${rec.feedSecret}`;
}

export function parseFeedToken(token: unknown): { id: string; secret: string } | null {
  if (typeof token !== "string") return null;
  const m = /^([0-9a-f]{12})_([0-9a-f]{16})(?:\.ics)?$/.exec(token.trim());
  return m ? { id: m[1], secret: m[2] } : null;
}

export function inboundDomain(): string | null {
  const d = (process.env.INBOUND_DOMAIN ?? "").trim().toLowerCase();
  return d || null;
}

export function inboundAddressOf(rec: Pick<FamilyRecord, "id" | "inboundCode">): string | null {
  const domain = inboundDomain();
  return domain ? `${rec.id}-${rec.inboundCode}@${domain}` : null;
}

export function features(): Features {
  return {
    gmail: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) && cryptoReady(),
    inbound: Boolean(inboundDomain() && process.env.INBOUND_SECRET),
  };
}

// "<id>-<code>@domain" or "Name <id-code@domain>"
export function parseInboundAddress(to: unknown): { id: string; code: string } | null {
  if (typeof to !== "string") return null;
  const m = /([0-9a-f]{12})-([0-9a-f]{8})@/i.exec(to);
  return m ? { id: m[1].toLowerCase(), code: m[2].toLowerCase() } : null;
}

// ---- settings ----

export function defaultSettings(locale?: string | null, timezone?: string | null): Settings {
  const country = countryOf(guessCountry(locale, timezone));
  return {
    familyName: "",
    country: country.code,
    language: isOutputLanguage(locale) ? locale : "en",
    timezone: timezone && isTimezone(timezone) ? timezone : country.timezone,
    dateOrder: country.dateOrder,
    currency: country.currency,
    weekStart: country.weekStart,
  };
}

// Accepts a partial update from the client and returns a valid Settings object.
export function sanitizeSettings(input: unknown, current: Settings): Settings {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const next: Settings = { ...current };
  if (typeof o.familyName === "string") next.familyName = o.familyName.trim().slice(0, 60);
  if (isCountry(o.country) && o.country !== current.country) {
    const c = countryOf(o.country);
    next.country = c.code;
    // A new country resets the derived defaults unless the same request sets them.
    next.dateOrder = c.dateOrder;
    next.currency = c.currency;
    next.weekStart = c.weekStart;
    if (!isTimezone(o.timezone)) next.timezone = c.timezone;
  }
  if (isOutputLanguage(o.language)) next.language = o.language;
  if (isTimezone(o.timezone)) next.timezone = o.timezone;
  if (o.dateOrder === "MDY" || o.dateOrder === "DMY" || o.dateOrder === "YMD") next.dateOrder = o.dateOrder;
  if (typeof o.currency === "string" && /^[A-Z]{3}$/.test(o.currency)) next.currency = o.currency;
  if (o.weekStart === 0 || o.weekStart === 1) next.weekStart = o.weekStart;
  return next;
}

export function sanitizeChildren(input: unknown, current: Child[]): Child[] {
  if (!Array.isArray(input)) return current;
  const out: Child[] = [];
  for (const raw of input.slice(0, MAX_CHILDREN)) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const name = typeof c.name === "string" ? c.name.trim().slice(0, 40) : "";
    if (!name) continue;
    const existing = typeof c.id === "string" ? current.find((x) => x.id === c.id) : undefined;
    const color = typeof c.color === "string" && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : existing?.color ?? CHILD_COLORS[out.length % CHILD_COLORS.length];
    out.push({ id: existing?.id ?? newId(4), name, color });
  }
  return out;
}

// ---- create / verify ----

export function createFamily(init: { settings?: Partial<Settings>; locale?: string | null; timezone?: string | null } = {}): { record: FamilyRecord; key: string } {
  const now = new Date().toISOString();
  const id = newId(6);
  const secret = newId(12);
  const base = defaultSettings(init.locale, init.timezone);
  const record: FamilyRecord = {
    id,
    keyHash: hashSecret(secret),
    feedSecret: newId(8),
    inboundCode: newId(4),
    createdAt: now,
    updatedAt: now,
    settings: sanitizeSettings(init.settings ?? {}, base),
    children: [],
    sources: [],
    items: [],
    usage: {},
  };
  return { record, key: makeFamilyKey(id, secret) };
}

export function verifySecret(rec: FamilyRecord, secret: string): boolean {
  const a = Buffer.from(rec.keyHash, "hex");
  const b = Buffer.from(hashSecret(secret), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyFeedSecret(rec: FamilyRecord, secret: string): boolean {
  const a = Buffer.from(rec.feedSecret, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function rotateFeed(rec: FamilyRecord) {
  rec.feedSecret = newId(8);
}

// ---- storage ----

type Mode = "local" | "blob" | "memory";
const memory = new Map<string, string>();

export function storageMode(): Mode {
  if (process.env.LOCAL_DATA_DIR) return "local";
  if (process.env.BLOB_READ_WRITE_TOKEN) return "blob";
  return "memory";
}

function localPath(id: string): string {
  const dir = path.join(process.env.LOCAL_DATA_DIR as string, "families");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${id}.json`);
}

async function readRaw(id: string): Promise<string | null> {
  switch (storageMode()) {
    case "local": {
      const p = localPath(id);
      return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
    }
    case "blob": {
      const res = await get(`${PREFIX}${id}.json`, { access: "private", useCache: false });
      if (!res || res.statusCode !== 200 || !res.stream) return null;
      return new Response(res.stream).text();
    }
    default:
      return memory.get(id) ?? null;
  }
}

async function writeRaw(id: string, body: string): Promise<void> {
  switch (storageMode()) {
    case "local":
      fs.writeFileSync(localPath(id), body, "utf8");
      return;
    case "blob":
      await put(`${PREFIX}${id}.json`, body, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      });
      return;
    default:
      memory.set(id, body);
  }
}

async function removeRaw(id: string): Promise<void> {
  switch (storageMode()) {
    case "local": {
      const p = localPath(id);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return;
    }
    case "blob":
      await del(`${PREFIX}${id}.json`);
      return;
    default:
      memory.delete(id);
  }
}

export async function loadFamily(id: string): Promise<FamilyRecord | null> {
  if (!/^[0-9a-f]{12}$/.test(id)) return null;
  const raw = await readRaw(id);
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as FamilyRecord;
    return rec && rec.id === id && rec.keyHash ? normalize(rec) : null;
  } catch {
    return null;
  }
}

// Fills in fields added after a record was first written.
function normalize(rec: FamilyRecord): FamilyRecord {
  rec.children ??= [];
  rec.sources ??= [];
  rec.items ??= [];
  rec.usage ??= {};
  rec.inboundCode ??= newId(4);
  rec.feedSecret ??= newId(8);
  rec.settings = sanitizeSettings(rec.settings, defaultSettings());
  return rec;
}

export async function saveFamily(rec: FamilyRecord): Promise<void> {
  rec.updatedAt = new Date().toISOString();
  if (rec.items.length > MAX_ITEMS) rec.items = rec.items.slice(-MAX_ITEMS);
  if (rec.sources.length > MAX_SOURCES) rec.sources = rec.sources.slice(-MAX_SOURCES);
  await writeRaw(rec.id, JSON.stringify(rec));
}

export async function deleteFamily(id: string): Promise<void> {
  await removeRaw(id);
}

// Test hook.
export function resetMemoryStore() {
  memory.clear();
}

// ---- cookies ----

export function parseFamilyCookie(cookieHeader: string | null): { id: string; secret: string } | null {
  if (!cookieHeader) return null;
  const m = new RegExp(`(?:^|;\\s*)${FAMILY_COOKIE}=([^;]+)`).exec(cookieHeader);
  return m ? parseFamilyKey(decodeURIComponent(m[1])) : null;
}

export async function familyFromRequest(req: Request): Promise<FamilyRecord | null> {
  const parsed = parseFamilyCookie(req.headers.get("cookie"));
  if (!parsed) return null;
  const rec = await loadFamily(parsed.id);
  if (!rec || !verifySecret(rec, parsed.secret)) return null;
  return rec;
}

export function familyCookie(key: string, secure: boolean): string {
  return `${FAMILY_COOKIE}=${key}; Path=/; Max-Age=63072000; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function clearFamilyCookie(secure: boolean): string {
  return `${FAMILY_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function isHttps(req: Request): boolean {
  return req.headers.get("x-forwarded-proto") === "https" || new URL(req.url).protocol === "https:";
}

// ---- views ----

export function toView(rec: FamilyRecord): FamilyView {
  const { keyHash: _k, feedSecret: _f, inboundCode: _i, gmail, ...rest } = rec;
  void _k;
  void _f;
  void _i;
  const gmailView = gmail
    ? { email: gmail.email, connectedAt: gmail.connectedAt, lastScanAt: gmail.lastScanAt, lastResult: gmail.lastResult, senders: gmail.senders, paused: gmail.paused }
    : null;
  return { ...rest, feedToken: feedTokenOf(rec), inboundAddress: inboundAddressOf(rec), gmail: gmailView, features: features() };
}

// ---- adding an extraction ----

function clampInt(x: unknown, lo: number, hi: number, fallback: number): number {
  return typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : fallback;
}

// Items the family already has are skipped (the same newsletter photographed twice, a trip
// that was in last week's e-mail and today's chat message). When nothing is new the notice
// is not recorded either; the caller reports the skipped count.
export function addExtraction(
  rec: FamilyRecord,
  extraction: Extraction,
  kind: SourceKind,
  pages: number,
  hintChildId?: string | null,
): { source: Source; items: Item[]; skipped: number } {
  const now = new Date().toISOString();
  const source: Source = {
    id: newId(5),
    ts: now,
    kind,
    title: extraction.source.title.slice(0, 160),
    sender: extraction.source.sender.slice(0, 120),
    summary: extraction.source.summary.slice(0, 1200),
    language: extraction.source.language_detected.slice(0, 12),
    pages,
    questions: extraction.questions_for_parent.slice(0, 3).map((q) => q.slice(0, 300)),
    messagesSeen: clampInt(extraction.source.messages_seen, 1, 500, 1),
    messagesUsed: clampInt(extraction.source.messages_used, 0, 500, 1),
  };
  const byName = new Map(rec.children.map((c) => [c.name.toLowerCase(), c.id]));
  const candidates: Item[] = extraction.items.slice(0, 40).map((it) => {
    const matched = it.children.map((n) => byName.get(n.trim().toLowerCase())).filter((x): x is string => Boolean(x));
    const childIds = matched.length ? [...new Set(matched)] : hintChildId && rec.children.some((c) => c.id === hintChildId) ? [hintChildId] : [];
    return {
      id: newId(5),
      sourceId: source.id,
      type: ITEM_TYPES.includes(it.type) ? it.type : "info",
      title: it.title.slice(0, 160),
      description: it.description.slice(0, 1000),
      date: isIsoDate(it.date) ? it.date : null,
      end_date: isIsoDate(it.end_date) ? it.end_date : null,
      time: isHhMm(it.time) ? it.time : null,
      end_time: isHhMm(it.end_time) ? it.end_time : null,
      all_day: it.all_day || !isHhMm(it.time),
      location: it.location ? it.location.slice(0, 200) : null,
      amount: typeof it.amount === "number" && Number.isFinite(it.amount) ? it.amount : null,
      currency: it.currency && /^[A-Z]{3}$/.test(it.currency) ? it.currency : it.amount != null ? rec.settings.currency : null,
      bring: it.bring.slice(0, 12).map((b) => b.slice(0, 80)),
      requires_action: Boolean(it.requires_action),
      action_text: it.action_text ? it.action_text.slice(0, 200) : null,
      confidence: it.confidence,
      quote: it.quote ? it.quote.slice(0, 300) : null,
      childIds,
      status: "open",
      createdAt: now,
      updatedAt: now,
    };
  });
  const items: Item[] = [];
  let skipped = 0;
  for (const c of candidates) {
    if (findDuplicate(c, rec.items)) skipped++;
    else items.push(c);
  }
  if (items.length === 0) return { source, items, skipped };
  rec.sources.push(source);
  rec.items.push(...items);
  const month = now.slice(0, 7);
  rec.usage[month] = (rec.usage[month] ?? 0) + 1;
  return { source, items, skipped };
}

// Applies an edit from the client to one item. Unknown fields are ignored.
export function applyItemPatch(item: Item, patch: Record<string, unknown>): Item {
  const next = { ...item };
  if (patch.status === "open" || patch.status === "done" || patch.status === "dismissed") next.status = patch.status;
  if (typeof patch.title === "string" && patch.title.trim()) next.title = patch.title.trim().slice(0, 160);
  if (typeof patch.description === "string") next.description = patch.description.slice(0, 1000);
  if (patch.date === null || isIsoDate(patch.date)) next.date = patch.date as string | null;
  if (patch.end_date === null || isIsoDate(patch.end_date)) next.end_date = patch.end_date as string | null;
  if (patch.time === null || isHhMm(patch.time)) {
    next.time = patch.time as string | null;
    next.all_day = next.time === null;
  }
  if (patch.end_time === null || isHhMm(patch.end_time)) next.end_time = patch.end_time as string | null;
  if (typeof patch.location === "string") next.location = patch.location.slice(0, 200) || null;
  if (patch.amount === null || (typeof patch.amount === "number" && Number.isFinite(patch.amount))) next.amount = patch.amount as number | null;
  if (typeof patch.type === "string" && (ITEM_TYPES as readonly string[]).includes(patch.type)) next.type = patch.type as ItemType;
  if (Array.isArray(patch.childIds)) next.childIds = patch.childIds.filter((x): x is string => typeof x === "string").slice(0, MAX_CHILDREN);
  if (Array.isArray(patch.bring)) next.bring = patch.bring.filter((x): x is string => typeof x === "string").slice(0, 12).map((b) => b.slice(0, 80));
  next.updatedAt = new Date().toISOString();
  return next;
}

// Every family id in the store (the daily Gmail cron walks them). Fine for a beta;
// a real index comes with a database.
export async function listFamilyIds(): Promise<string[]> {
  switch (storageMode()) {
    case "local": {
      const dir = path.join(process.env.LOCAL_DATA_DIR as string, "families");
      return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^[0-9a-f]{12}\.json$/.test(f)).map((f) => f.slice(0, 12)) : [];
    }
    case "blob": {
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
        for (const b of page.blobs) {
          const m = /([0-9a-f]{12})\.json$/.exec(b.pathname);
          if (m) ids.push(m[1]);
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return ids;
    }
    default:
      return [...memory.keys()];
  }
}
