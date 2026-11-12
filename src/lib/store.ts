import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { del, get, list, put } from "@vercel/blob";
import { countryOf, guessCountry, isCountry, isTimezone } from "./countries";
import { cryptoReady } from "./crypto";
import { findDuplicate } from "./dedupe";
import { mergeFamily } from "./merge";
import { addDays, isHhMm, isIsoDate } from "./dates";
import { isLocale } from "./i18n/locales";
import { billingEnabled, canUse, planLimits, planOf } from "./plan";
import { ITEM_TYPES, isOutputLanguage, type ExtractedItem, type Extraction, type ItemType } from "./schema";
import { CHILD_COLORS, MAX_CHILDREN, RECURRENCES, type Child, type FamilyRecord, type FamilyView, type Features, type Invite, type Item, type Recurrence, type Settings, type Source, type SourceKind } from "./types";

export * from "./types";

// One family = one JSON document. No accounts: the family key (id + secret) lives in an
// HttpOnly cookie and can be pasted on a partner's phone. Storage is Vercel Blob in
// production, a folder in development, memory in tests.
//
// What is stored: settings, children (name and colour only), the notices' summaries and
// the extracted items. Uploaded photos and PDFs are never stored.

export const FAMILY_COOKIE = "pd_family";
const ROOT = "parentdesk/";
const FAMILIES = "families/";
const OPS = "ops/";
export const MAX_ITEMS = 2000;
export const MAX_SOURCES = 400;

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

// The device-automation address: "<id>_<hookSecret>". An iPhone Shortcut or an Android
// automation app POSTs school messages to it; the secret is long-lived and can be rotated.
export function hookTokenOf(rec: Pick<FamilyRecord, "id" | "hookSecret">): string {
  return `${rec.id}_${rec.hookSecret}`;
}

export function parseHookToken(token: unknown): { id: string; secret: string } | null {
  if (typeof token !== "string") return null;
  const m = /^([0-9a-f]{12})_([0-9a-f]{16})$/.exec(token.trim());
  return m ? { id: m[1], secret: m[2] } : null;
}

export function verifyHookSecret(rec: FamilyRecord, secret: string): boolean {
  const a = Buffer.from(rec.hookSecret, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function rotateHook(rec: FamilyRecord) {
  rec.hookSecret = newId(8);
}

export function inboundDomain(): string | null {
  const d = (process.env.INBOUND_DOMAIN ?? "").trim().toLowerCase();
  return d || null;
}

export function inboundAddressOf(rec: Pick<FamilyRecord, "id" | "inboundCode">): string | null {
  const domain = inboundDomain();
  return domain ? `${rec.id}-${rec.inboundCode}@${domain}` : null;
}

export function digestEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.DIGEST_FROM);
}

export function features(): Features {
  return {
    gmail: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) && cryptoReady(),
    inbound: Boolean(inboundDomain() && process.env.INBOUND_SECRET),
    billing: billingEnabled(),
    digest: digestEnabled(),
    push: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
  };
}

// "<id>-<code>@domain" or "Name <id-code@domain>"
export function parseInboundAddress(to: unknown): { id: string; code: string } | null {
  if (typeof to !== "string") return null;
  const m = /([0-9a-f]{12})-([0-9a-f]{8})@/i.exec(to);
  return m ? { id: m[1].toLowerCase(), code: m[2].toLowerCase() } : null;
}

// ---- settings ----

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(x: unknown): x is string {
  return typeof x === "string" && x.length <= 120 && EMAIL_RE.test(x);
}

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
    locale: isLocale(locale) ? locale : "", // empty = not known yet (records from before v0.4)
    digest: false,
    digestEmail: "",
    members: [],
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
  if (isLocale(o.locale)) next.locale = o.locale;
  if (typeof o.digest === "boolean") next.digest = o.digest;
  if (typeof o.digestEmail === "string") {
    const e = o.digestEmail.trim().toLowerCase();
    if (e === "" || isEmail(e)) next.digestEmail = e;
  }
  if (!next.digestEmail) next.digest = false;
  if (Array.isArray(o.members)) next.members = [...new Set(o.members.filter((m): m is string => typeof m === "string").map((m) => m.trim().slice(0, 20)).filter(Boolean))].slice(0, 6);
  next.members ??= [];
  return next;
}

export function sanitizeChildren(input: unknown, current: Child[], max = MAX_CHILDREN): Child[] {
  if (!Array.isArray(input)) return current;
  const out: Child[] = [];
  for (const raw of input.slice(0, Math.min(max, MAX_CHILDREN))) {
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
    rev: 0,
    feedSecret: newId(8),
    hookSecret: newId(8),
    inboundCode: newId(4),
    createdAt: now,
    updatedAt: now,
    settings: sanitizeSettings(init.settings ?? {}, base),
    children: [],
    sources: [],
    items: [],
    usage: {},
    billing: null,
    invites: [],
    digest: null,
    counters: {},
  };
  return { record, key: makeFamilyKey(id, secret) };
}

export function verifySecret(rec: FamilyRecord, secret: string): boolean {
  const given = Buffer.from(hashSecret(secret), "hex");
  for (const h of [rec.keyHash, ...(rec.memberHashes ?? [])]) {
    const a = Buffer.from(h, "hex");
    if (a.length === given.length && timingSafeEqual(a, given)) return true;
  }
  return false;
}

// A key of its own for a device that joined through an invite link. It opens the family
// exactly like the first key; the record keeps only its hash.
const MAX_MEMBER_KEYS = 10;
export function addMemberKey(rec: FamilyRecord): string {
  const secret = newId(12);
  rec.memberHashes = [...(rec.memberHashes ?? []), hashSecret(secret)].slice(-MAX_MEMBER_KEYS);
  return makeFamilyKey(rec.id, secret);
}

export function verifyFeedSecret(rec: FamilyRecord, secret: string): boolean {
  const a = Buffer.from(rec.feedSecret, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function rotateFeed(rec: FamilyRecord) {
  rec.feedSecret = newId(8);
}

export function bumpCounter(rec: FamilyRecord, name: string, by = 1) {
  rec.counters ??= {};
  rec.counters[name] = (rec.counters[name] ?? 0) + by;
}

// ---- invite links ----
//
// "<family id>.<secret>": the family keeps sha256(secret), the link carries the secret.
// A link works a few times for a few days, so a screenshot that leaks later is useless.

export const INVITE_TTL_HOURS = 72;
export const INVITE_MAX_USES = 3;
const MAX_LIVE_INVITES = 5;

export function liveInvites(rec: FamilyRecord, now: Date = new Date()): Invite[] {
  const t = now.toISOString();
  return (rec.invites ?? []).filter((i) => i.expiresAt > t && i.uses < i.maxUses);
}

export function createInvite(rec: FamilyRecord, now: Date = new Date()): { token: string; invite: Invite } | null {
  const live = liveInvites(rec, now);
  if (live.length >= MAX_LIVE_INVITES) return null;
  const secret = newId(16);
  const invite: Invite = {
    hash: hashSecret(secret),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + INVITE_TTL_HOURS * 3600_000).toISOString(),
    uses: 0,
    maxUses: INVITE_MAX_USES,
  };
  rec.invites = [...live, invite];
  return { token: `${rec.id}.${secret}`, invite };
}

export function parseInviteToken(token: unknown): { id: string; secret: string } | null {
  if (typeof token !== "string") return null;
  const m = /^([0-9a-f]{12})\.([0-9a-f]{32})$/.exec(token.trim());
  return m ? { id: m[1], secret: m[2] } : null;
}

// Marks one use and returns true when the token matched a live invite.
export function acceptInvite(rec: FamilyRecord, secret: string, now: Date = new Date()): boolean {
  const h = Buffer.from(hashSecret(secret), "hex");
  for (const inv of liveInvites(rec, now)) {
    const a = Buffer.from(inv.hash, "hex");
    if (a.length === h.length && timingSafeEqual(a, h)) {
      inv.uses += 1;
      rec.invites = liveInvites(rec, now);
      return true;
    }
  }
  return false;
}

// ---- storage ----

type Mode = "local" | "blob" | "memory";
const memory = new Map<string, string>();

export function storageMode(): Mode {
  if (process.env.LOCAL_DATA_DIR) return "local";
  if (process.env.BLOB_READ_WRITE_TOKEN) return "blob";
  return "memory";
}

function localPath(key: string): string {
  const p = path.join(process.env.LOCAL_DATA_DIR as string, `${key}.json`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

// `key` is "families/<id>" or "ops/<name>".
async function readRaw(key: string): Promise<string | null> {
  switch (storageMode()) {
    case "local": {
      const p = localPath(key);
      return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
    }
    case "blob": {
      const res = await get(`${ROOT}${key}.json`, { access: "private", useCache: false });
      if (!res || res.statusCode !== 200 || !res.stream) return null;
      return new Response(res.stream).text();
    }
    default:
      return memory.get(key) ?? null;
  }
}

async function writeRaw(key: string, body: string): Promise<void> {
  switch (storageMode()) {
    case "local":
      fs.writeFileSync(localPath(key), body, "utf8");
      return;
    case "blob":
      await put(`${ROOT}${key}.json`, body, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      });
      return;
    default:
      memory.set(key, body);
  }
}

async function removeRaw(key: string): Promise<void> {
  switch (storageMode()) {
    case "local": {
      const p = localPath(key);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return;
    }
    case "blob":
      await del(`${ROOT}${key}.json`);
      return;
    default:
      memory.delete(key);
  }
}

// Other document kinds (teachers, class rooms in lib/rooms.ts) share the same storage.
// `key` is "<folder>/<id>" with a folder name of letters and an id of hex characters.
const DOC_KEY = /^[a-z]{1,20}\/[0-9a-f]{12}$/;

export async function readDoc(key: string): Promise<string | null> {
  return DOC_KEY.test(key) ? readRaw(key) : null;
}

export async function writeDoc(key: string, body: string): Promise<void> {
  if (!DOC_KEY.test(key)) throw new Error("bad document key");
  await writeRaw(key, body);
}

// Writes a document only when none exists under that key; false when one already does.
// The check and the write are one step in every storage mode, so two callers racing for
// the same key cannot both win.
export async function createDoc(key: string, body: string): Promise<boolean> {
  if (!DOC_KEY.test(key)) throw new Error("bad document key");
  switch (storageMode()) {
    case "local":
      try {
        fs.writeFileSync(localPath(key), body, { encoding: "utf8", flag: "wx" });
        return true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw e;
      }
    case "blob":
      try {
        await put(`${ROOT}${key}.json`, body, { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/json" });
        return true;
      } catch (e) {
        // the store refuses to overwrite: tell "already there" apart from a real failure
        if ((await readRaw(key)) !== null) return false;
        throw e;
      }
    default:
      if (memory.has(key)) return false;
      memory.set(key, body);
      return true;
  }
}

export async function removeDoc(key: string): Promise<void> {
  if (DOC_KEY.test(key)) await removeRaw(key);
}

// ---- marks ----
// Tiny entries grouped in buckets (the rate limiter's counters, lib/ratelimit.ts): one
// entry per counted event, added and removed but never rewritten, counted by listing the
// bucket. They hold no content: the name is all there is.
const MARKS = "marks/";
const MARK_BUCKET = /^[a-z][0-9]{1,12}-[0-9a-f]{24}$/;
const MARK_NAME = /^[0-9a-z]{8,40}$/;
const memoryMarks = new Map<string, Set<string>>();

function marksDir(bucket?: string): string {
  return path.join(process.env.LOCAL_DATA_DIR as string, "marks", bucket ?? "");
}

export async function addMark(bucket: string, name: string): Promise<void> {
  if (!MARK_BUCKET.test(bucket) || !MARK_NAME.test(name)) throw new Error("bad mark");
  switch (storageMode()) {
    case "local":
      fs.mkdirSync(marksDir(bucket), { recursive: true });
      fs.writeFileSync(path.join(marksDir(bucket), name), "", "utf8");
      return;
    case "blob":
      await put(`${ROOT}${MARKS}${bucket}/${name}`, "1", { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "text/plain" });
      return;
    default: {
      const set = memoryMarks.get(bucket) ?? new Set<string>();
      set.add(name);
      memoryMarks.set(bucket, set);
    }
  }
}

export async function listMarks(bucket: string): Promise<string[]> {
  if (!MARK_BUCKET.test(bucket)) throw new Error("bad mark");
  switch (storageMode()) {
    case "local":
      return fs.existsSync(marksDir(bucket)) ? fs.readdirSync(marksDir(bucket)).filter((f) => MARK_NAME.test(f)) : [];
    case "blob": {
      const prefix = `${ROOT}${MARKS}${bucket}/`;
      const names: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, cursor, limit: 1000 });
        for (const b of page.blobs) {
          const name = b.pathname.slice(prefix.length);
          if (MARK_NAME.test(name)) names.push(name);
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return names;
    }
    default:
      return [...(memoryMarks.get(bucket) ?? [])];
  }
}

export async function removeMark(bucket: string, name: string): Promise<void> {
  if (!MARK_BUCKET.test(bucket) || !MARK_NAME.test(name)) return;
  switch (storageMode()) {
    case "local": {
      const p = path.join(marksDir(bucket), name);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return;
    }
    case "blob":
      await del(`${ROOT}${MARKS}${bucket}/${name}`);
      return;
    default:
      memoryMarks.get(bucket)?.delete(name);
  }
}

// Removes every bucket `keep` says no to; returns how many entries went.
export async function sweepMarks(keep: (bucket: string) => boolean): Promise<number> {
  let gone = 0;
  switch (storageMode()) {
    case "local": {
      if (!fs.existsSync(marksDir())) return 0;
      for (const bucket of fs.readdirSync(marksDir())) {
        if (keep(bucket)) continue;
        gone += fs.readdirSync(marksDir(bucket)).length;
        fs.rmSync(marksDir(bucket), { recursive: true, force: true });
      }
      return gone;
    }
    case "blob": {
      const prefix = `${ROOT}${MARKS}`;
      let cursor: string | undefined;
      const old: string[] = [];
      do {
        const page = await list({ prefix, cursor, limit: 1000 });
        for (const b of page.blobs) {
          const bucket = b.pathname.slice(prefix.length).split("/")[0];
          if (!keep(bucket)) old.push(b.pathname);
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      for (let i = 0; i < old.length; i += 200) {
        await del(old.slice(i, i + 200));
        gone += Math.min(200, old.length - i);
      }
      return gone;
    }
    default:
      for (const [bucket, set] of memoryMarks) {
        if (keep(bucket)) continue;
        gone += set.size;
        memoryMarks.delete(bucket);
      }
      return gone;
  }
}

// Development and tests only: the shared store is never emptied from here.
export function wipeMarks(): void {
  if (storageMode() === "local") fs.rmSync(marksDir(), { recursive: true, force: true });
  else if (storageMode() === "memory") memoryMarks.clear();
}

// The version this request loaded, kept off the record on a Symbol so it is never written to
// storage (JSON.stringify skips symbols) nor sent to the browser (toView spreads only string
// keys). saveFamily reads it to tell a clean write from one that landed on top of a
// concurrent change and must be merged (lib/merge.ts).
const BASELINE = Symbol("pdBaseline");
type Baseline = { rev: number; raw: string };

function setBaseline(rec: FamilyRecord, rev: number, raw: string) {
  Object.defineProperty(rec, BASELINE, { value: { rev, raw } as Baseline, enumerable: false, configurable: true, writable: true });
}

function baselineOf(rec: FamilyRecord): Baseline | undefined {
  return (rec as { [BASELINE]?: Baseline })[BASELINE];
}

export async function loadFamily(id: string): Promise<FamilyRecord | null> {
  if (!/^[0-9a-f]{12}$/.test(id)) return null;
  const raw = await readRaw(`${FAMILIES}${id}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as FamilyRecord;
    if (!parsed || parsed.id !== id || !parsed.keyHash) return null;
    const rec = normalize(parsed);
    setBaseline(rec, rec.rev ?? 0, raw);
    return rec;
  } catch {
    return null;
  }
}

// Fills in fields added after a record was first written.
function normalize(rec: FamilyRecord): FamilyRecord {
  rec.rev ??= 0;
  rec.children ??= [];
  rec.sources ??= [];
  rec.items ??= [];
  rec.usage ??= {};
  rec.inboundCode ??= newId(4);
  rec.feedSecret ??= newId(8);
  // Records from before the address existed: derive it from the key hash, so it stays the
  // same across loads without a write; a rotation stores a random one.
  rec.hookSecret ??= createHash("sha256").update(`hook:${rec.keyHash}`).digest("hex").slice(0, 16);
  rec.memberHashes ??= [];
  rec.billing ??= null;
  rec.invites ??= [];
  rec.digest ??= null;
  rec.counters ??= {};
  rec.rooms ??= [];
  rec.push ??= [];
  rec.settings = sanitizeSettings(rec.settings, defaultSettings());
  return rec;
}

function trimFamily(rec: FamilyRecord) {
  if (rec.items.length > MAX_ITEMS) rec.items = rec.items.slice(-MAX_ITEMS);
  if (rec.sources.length > MAX_SOURCES) rec.sources = rec.sources.slice(-MAX_SOURCES);
}

// Writes the family document. Because the whole JSON is rewritten, two devices in one family
// (no accounts — a parent and their partner) can each load it, change it, and save; the later
// save would blindly drop the earlier one's work. So before writing we re-read what is stored
// now: if it moved on since this request loaded it, we replay this request's change onto the
// latest version (lib/merge.ts) instead of overwriting it. The re-read cannot be atomic with
// the write on Blob, so a true simultaneous write is still last-one-wins; what this removes is
// the human-scale loss, where one phone held the page for a while before saving.
export async function saveFamily(rec: FamilyRecord): Promise<void> {
  rec.updatedAt = new Date().toISOString();
  trimFamily(rec);
  const key = `${FAMILIES}${rec.id}`;
  const base = baselineOf(rec);

  let stored: FamilyRecord | null = null;
  try {
    const raw = await readRaw(key);
    stored = raw ? (JSON.parse(raw) as FamilyRecord) : null;
  } catch {
    stored = null; // unreadable: fall through to a plain write
  }

  // No baseline (a brand-new family, or a test fixture) or nothing stored yet: write as before.
  // No baseline + something stored is a deliberate blind write; keep the version climbing.
  if (!base || !stored) {
    rec.rev = (stored?.rev ?? -1) + 1;
    const body = JSON.stringify(rec);
    await writeRaw(key, body);
    setBaseline(rec, rec.rev, body);
    return;
  }

  // Nobody wrote since this request loaded: a normal save.
  if ((stored.rev ?? 0) === base.rev) {
    rec.rev = base.rev + 1;
    const body = JSON.stringify(rec);
    await writeRaw(key, body);
    setBaseline(rec, rec.rev, body);
    return;
  }

  // A concurrent write landed. Replay this request's change onto it.
  const theirs = normalize(stored);
  let merged: FamilyRecord;
  try {
    merged = mergeFamily(normalize(JSON.parse(base.raw) as FamilyRecord), rec, theirs);
  } catch {
    merged = rec; // baseline unreadable: keep this request's version
  }
  merged.id = rec.id;
  merged.updatedAt = rec.updatedAt;
  merged.rev = (theirs.rev ?? 0) + 1;
  trimFamily(merged);
  const body = JSON.stringify(merged);
  await writeRaw(key, body);
  // Make the in-memory record match what was stored, so the route's response reflects the
  // merge and a second save in the same request starts from a clean baseline.
  for (const k of Object.keys(rec)) delete (rec as Record<string, unknown>)[k];
  Object.assign(rec, merged);
  setBaseline(rec, merged.rev, body);
}

export async function deleteFamily(id: string): Promise<void> {
  await removeRaw(`${FAMILIES}${id}`);
}

// Small operational documents next to the families (last cron runs, for the admin page).
export async function readOps<T>(name: string): Promise<T | null> {
  if (!/^[a-z_-]{1,40}$/.test(name)) return null;
  const raw = await readRaw(`${OPS}${name}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeOps(name: string, value: unknown): Promise<void> {
  if (!/^[a-z_-]{1,40}$/.test(name)) throw new Error("bad ops name");
  await writeRaw(`${OPS}${name}`, JSON.stringify(value));
}

// Test hook.
export function resetMemoryStore() {
  memoryMarks.clear();
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
  const { keyHash: _k, memberHashes: _m, feedSecret: _f, hookSecret: _h, inboundCode: _i, gmail, billing, invites: _inv, counters: _c, push, ...rest } = rec;
  void _k;
  void _m;
  void _f;
  void _h;
  void _i;
  void _inv;
  void _c;
  const gmailView = gmail
    ? { email: gmail.email, connectedAt: gmail.connectedAt, lastScanAt: gmail.lastScanAt, lastResult: gmail.lastResult, senders: gmail.senders, paused: gmail.paused }
    : null;
  const billingView = billing
    ? { status: billing.status, interval: billing.interval, currentPeriodEnd: billing.currentPeriodEnd, cancelAtPeriodEnd: billing.cancelAtPeriodEnd, updatedAt: billing.updatedAt }
    : null;
  return {
    ...rest,
    feedToken: feedTokenOf(rec),
    hookToken: hookTokenOf(rec),
    inboundAddress: canUse(rec, "inbound") ? inboundAddressOf(rec) : null,
    gmail: gmailView,
    features: features(),
    plan: planOf(rec),
    billing: billingView,
    limits: planLimits(),
    invites: liveInvites(rec).length,
    pushKey: features().push ? (process.env.VAPID_PUBLIC_KEY as string) : null,
    pushDevices: (push ?? []).length,
    pushIds: (push ?? []).map((p) => createHash("sha256").update(p.endpoint).digest("hex").slice(0, 16)),
  };
}

// ---- adding an extraction ----

function clampInt(x: unknown, lo: number, hi: number, fallback: number): number {
  return typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : fallback;
}

// An item as the extractor returns it, sanitised, before it belongs to a family: no id,
// no children, no status. Teachers' room posts are stored in this shape and turned into
// items for each family that follows the room (lib/rooms.ts).
export type ItemDraft = Omit<Item, "id" | "sourceId" | "childIds" | "status" | "createdAt" | "updatedAt">;

export function draftItem(it: ExtractedItem, defaultCurrency: string): ItemDraft {
  return {
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
    currency: it.currency && /^[A-Z]{3}$/.test(it.currency) ? it.currency : it.amount != null ? defaultCurrency : null,
    bring: it.bring.slice(0, 12).map((b) => b.slice(0, 80)),
    requires_action: Boolean(it.requires_action),
    action_text: it.action_text ? it.action_text.slice(0, 200) : null,
    confidence: it.confidence,
    quote: it.quote ? it.quote.slice(0, 300) : null,
    ...(it.recurrence && it.recurrence !== "none" ? { recurrence: it.recurrence } : {}),
  };
}

export function sourceFromExtraction(extraction: Extraction, kind: SourceKind, pages: number, now: string = new Date().toISOString()): Source {
  return {
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
}

// Items the family already has are skipped (the same newsletter photographed twice, a trip
// that was in last week's e-mail and today's chat message). When nothing is new the notice
// is not recorded either; the caller reports the skipped count. `countUsage` is off for
// notices the family did not extract itself (a teacher's post).
export function commitItems(rec: FamilyRecord, source: Source, drafts: { draft: ItemDraft; childIds: string[] }[], countUsage = true): { items: Item[]; skipped: number } {
  const now = source.ts;
  const items: Item[] = [];
  let skipped = 0;
  for (const { draft, childIds } of drafts.slice(0, 40)) {
    const candidate: Item = { ...draft, id: newId(5), sourceId: source.id, childIds, status: "open", createdAt: now, updatedAt: now };
    if (findDuplicate(candidate, rec.items)) skipped++;
    else items.push(candidate);
  }
  if (items.length === 0) return { items, skipped };
  rec.sources.push(source);
  rec.items.push(...items);
  if (countUsage) {
    const month = now.slice(0, 7);
    rec.usage[month] = (rec.usage[month] ?? 0) + 1;
  }
  return { items, skipped };
}

export function addExtraction(
  rec: FamilyRecord,
  extraction: Extraction,
  kind: SourceKind,
  pages: number,
  hintChildId?: string | null,
): { source: Source; items: Item[]; skipped: number } {
  const source = sourceFromExtraction(extraction, kind, pages);
  const byName = new Map(rec.children.map((c) => [c.name.toLowerCase(), c.id]));
  const hint = hintChildId && rec.children.some((c) => c.id === hintChildId) ? [hintChildId] : [];
  const drafts = extraction.items.slice(0, 40).map((it) => {
    const matched = it.children.map((n) => byName.get(n.trim().toLowerCase())).filter((x): x is string => Boolean(x));
    return { draft: draftItem(it, rec.settings.currency), childIds: matched.length ? [...new Set(matched)] : hint };
  });
  const { items, skipped } = commitItems(rec, source, drafts);
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
  if (patch.owner === null) delete next.owner;
  else if (typeof patch.owner === "string" && patch.owner.trim()) next.owner = patch.owner.trim().slice(0, 20);
  if (patch.recurrence === null) delete next.recurrence;
  else if (typeof patch.recurrence === "string" && (RECURRENCES as readonly string[]).includes(patch.recurrence)) next.recurrence = patch.recurrence as Recurrence;
  next.updatedAt = new Date().toISOString();
  return next;
}

// The next time a repeating item comes round, as a fresh open item: ticking "library books
// every Monday" off makes next Monday's. Null for one-off or undated items.
export function nextOccurrence(item: Item, now: string = new Date().toISOString()): Item | null {
  if (!item.recurrence || !item.date) return null;
  const shift = (iso: string): string => {
    if (item.recurrence === "monthly") {
      const d = new Date(`${iso}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      return d.toISOString().slice(0, 10);
    }
    return addDays(iso, item.recurrence === "daily" ? 1 : item.recurrence === "weekly" ? 7 : 14);
  };
  const next: Item = { ...item, id: newId(5), date: shift(item.date), end_date: item.end_date ? shift(item.end_date) : null, status: "open", createdAt: now, updatedAt: now };
  delete next.roomItemIndex;
  return next;
}

// Every family id in the store (the daily crons and the admin page walk them). Fine for a
// beta; a real index comes with a database.
export async function listFamilyIds(): Promise<string[]> {
  return listDocIds(FAMILIES);
}

// Every id under a folder ("families/", "teachers/", "rooms/").
export async function listDocIds(folder: string): Promise<string[]> {
  switch (storageMode()) {
    case "local": {
      const dir = path.join(process.env.LOCAL_DATA_DIR as string, folder);
      return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^[0-9a-f]{12}\.json$/.test(f)).map((f) => f.slice(0, 12)) : [];
    }
    case "blob": {
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix: `${ROOT}${folder}`, cursor, limit: 1000 });
        for (const b of page.blobs) {
          const m = /([0-9a-f]{12})\.json$/.exec(b.pathname);
          if (m) ids.push(m[1]);
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return ids;
    }
    default:
      return [...memory.keys()].filter((k) => k.startsWith(folder)).map((k) => k.slice(folder.length));
  }
}
