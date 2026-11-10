import { createHash, timingSafeEqual } from "node:crypto";
import { planOf } from "./plan";
import { features } from "./store";
import type { FamilyRecord } from "./types";

// The operator's console: one shared token (ADMIN_TOKEN) exchanged for an HttpOnly cookie
// holding its hash. The stats are computed by walking every family document; no item text
// or child names ever leave the server through this path.

export const ADMIN_COOKIE = "pd_admin";
const COOKIE_MAX_AGE = 12 * 3600;

export function adminEnabled(): boolean {
  return (process.env.ADMIN_TOKEN ?? "").trim().length >= 16;
}

function tokenHash(): string {
  return createHash("sha256").update((process.env.ADMIN_TOKEN ?? "").trim()).digest("hex");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkAdminToken(given: unknown): boolean {
  if (!adminEnabled() || typeof given !== "string") return false;
  return same(given.trim(), (process.env.ADMIN_TOKEN ?? "").trim());
}

export function adminCookie(secure: boolean): string {
  return `${ADMIN_COOKIE}=${tokenHash()}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

export function clearAdminCookie(secure: boolean): string {
  return `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

export function isAdminRequest(req: Request): boolean {
  if (!adminEnabled()) return false;
  const header = req.headers.get("cookie") ?? "";
  const m = new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE}=([0-9a-f]{64})`).exec(header);
  return Boolean(m && same(m[1], tokenHash()));
}

// ---- aggregates ----

export type Stats = {
  generatedAt: string;
  families: { total: number; created7d: number; created30d: number; active7d: number; withChildren: number; withItems: number; truncated: boolean };
  children: number;
  items: { total: number; open: number; done: number; dismissed: number; byType: Record<string, number>; needsCheck: number };
  sources: { total: number; last7d: number; byKind: Record<string, number> };
  notices: { thisMonth: number; byDay: { day: string; n: number }[] };
  plans: { free: number; family: number; statuses: Record<string, number> };
  gmail: { connected: number; paused: number };
  digest: { on: number };
  invites: { live: number };
  push: { families: number; devices: number }; // notifications switched on
  following: number; // families that follow at least one class room
  top: { countries: [string, number][]; languages: [string, number][]; locales: [string, number][] };
  counters: Record<string, number>;
};

const bump = (m: Record<string, number>, k: string, by = 1) => {
  m[k] = (m[k] ?? 0) + by;
};
const top = (m: Record<string, number>, n = 10): [string, number][] => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);

export function computeStats(records: FamilyRecord[], now: Date = new Date(), truncated = false): Stats {
  const t = now.getTime();
  const d7 = new Date(t - 7 * 86400000).toISOString();
  const d30 = new Date(t - 30 * 86400000).toISOString();
  const month = now.toISOString().slice(0, 7);
  const days: Record<string, number> = {};
  for (let i = 13; i >= 0; i--) days[new Date(t - i * 86400000).toISOString().slice(0, 10)] = 0;

  const s: Stats = {
    generatedAt: now.toISOString(),
    families: { total: records.length, created7d: 0, created30d: 0, active7d: 0, withChildren: 0, withItems: 0, truncated },
    children: 0,
    items: { total: 0, open: 0, done: 0, dismissed: 0, byType: {}, needsCheck: 0 },
    sources: { total: 0, last7d: 0, byKind: {} },
    notices: { thisMonth: 0, byDay: [] },
    plans: { free: 0, family: 0, statuses: {} },
    gmail: { connected: 0, paused: 0 },
    digest: { on: 0 },
    invites: { live: 0 },
    push: { families: 0, devices: 0 },
    following: 0,
    top: { countries: [], languages: [], locales: [] },
    counters: {},
  };
  const countries: Record<string, number> = {};
  const languages: Record<string, number> = {};
  const locales: Record<string, number> = {};
  const nowIso = now.toISOString();

  for (const r of records) {
    if (r.createdAt >= d7) s.families.created7d++;
    if (r.createdAt >= d30) s.families.created30d++;
    if (r.updatedAt >= d7) s.families.active7d++;
    if (r.children.length) s.families.withChildren++;
    if (r.items.length) s.families.withItems++;
    s.children += r.children.length;
    for (const it of r.items) {
      s.items.total++;
      s.items[it.status]++;
      bump(s.items.byType, it.type);
      if (it.confidence !== "high" && it.status === "open") s.items.needsCheck++;
    }
    for (const src of r.sources) {
      s.sources.total++;
      if (src.ts >= d7) s.sources.last7d++;
      bump(s.sources.byKind, src.kind);
      const day = src.ts.slice(0, 10);
      if (day in days) days[day]++;
    }
    s.notices.thisMonth += r.usage[month] ?? 0;
    const plan = planOf(r, now);
    s.plans[plan]++;
    if (r.billing) bump(s.plans.statuses, r.billing.status);
    if (r.gmail) {
      s.gmail.connected++;
      if (r.gmail.paused) s.gmail.paused++;
    }
    if (r.settings.digest && r.settings.digestEmail) s.digest.on++;
    if ((r.push ?? []).length) {
      s.push.families++;
      s.push.devices += (r.push ?? []).length;
    }
    if ((r.rooms ?? []).length) s.following++;
    s.invites.live += (r.invites ?? []).filter((i) => i.expiresAt > nowIso && i.uses < i.maxUses).length;
    bump(countries, r.settings.country);
    bump(languages, r.settings.language);
    bump(locales, r.settings.locale);
    for (const [k, v] of Object.entries(r.counters ?? {})) bump(s.counters, k, v);
  }
  s.notices.byDay = Object.entries(days).map(([day, n]) => ({ day, n }));
  s.top = { countries: top(countries), languages: top(languages), locales: top(locales) };
  return s;
}

// One family, without personal content: counts, settings and billing state only.
export function familySummary(r: FamilyRecord, now: Date = new Date()) {
  return {
    id: r.id,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    plan: planOf(r, now),
    billing: r.billing ? { status: r.billing.status, interval: r.billing.interval, currentPeriodEnd: r.billing.currentPeriodEnd, cancelAtPeriodEnd: r.billing.cancelAtPeriodEnd, customerId: r.billing.customerId } : null,
    settings: { country: r.settings.country, language: r.settings.language, locale: r.settings.locale, timezone: r.settings.timezone, digest: r.settings.digest && Boolean(r.settings.digestEmail) },
    children: r.children.length,
    items: { total: r.items.length, open: r.items.filter((i) => i.status === "open").length },
    sources: r.sources.length,
    usage: r.usage,
    gmail: r.gmail ? { connectedAt: r.gmail.connectedAt, lastScanAt: r.gmail.lastScanAt, paused: r.gmail.paused, lastResult: r.gmail.lastResult } : null,
    digest: r.digest ?? null,
    counters: r.counters ?? {},
  };
}

// ---- lists for the console tables: counts and settings only, never item text or child names ----

export type FamilyRow = { id: string; createdAt: string; updatedAt: string; country: string; language: string; children: number; items: number; open: number; sources: number; monthUsage: number; plan: string; rooms: number; push: number; gmail: boolean; empty: boolean };

const EMPTY_AFTER_DAYS = 30;

// A family nobody ever used: created and last touched a month ago or more, and nothing on
// it at all (no items, notices, children, rooms, Gmail, billing, partner keys, live invites,
// notification devices, usage or name). Only these are safe to clear out.
export function isAbandoned(r: FamilyRecord, now: Date = new Date()): boolean {
  const cutoff = now.getTime() - EMPTY_AFTER_DAYS * 86400000;
  const quiet = new Date(r.createdAt).getTime() < cutoff && new Date(r.updatedAt).getTime() < cutoff;
  const nowIso = now.toISOString();
  return (
    quiet &&
    r.items.length === 0 &&
    r.sources.length === 0 &&
    r.children.length === 0 &&
    (r.rooms ?? []).length === 0 &&
    !r.gmail &&
    !r.billing &&
    (r.memberHashes ?? []).length === 0 &&
    (r.push ?? []).length === 0 &&
    !(r.invites ?? []).some((i) => i.expiresAt > nowIso && i.uses < i.maxUses) &&
    Object.values(r.usage ?? {}).every((n) => !n) &&
    Object.values(r.counters ?? {}).every((n) => !n) &&
    !r.settings.familyName &&
    !r.settings.digestEmail &&
    (r.settings.members ?? []).length === 0
  );
}

// A subscription Stripe still bills: the family must not vanish underneath it.
export function hasLiveSubscription(r: FamilyRecord): boolean {
  return Boolean(r.billing?.subscriptionId) && ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(r.billing?.status ?? "");
}

export function familyRow(r: FamilyRecord, now: Date = new Date()): FamilyRow {
  return {
    id: r.id,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    country: r.settings.country,
    language: r.settings.language,
    children: r.children.length,
    items: r.items.length,
    open: r.items.filter((i) => i.status === "open").length,
    sources: r.sources.length,
    monthUsage: r.usage[now.toISOString().slice(0, 7)] ?? 0,
    plan: planOf(r, now),
    rooms: (r.rooms ?? []).length,
    push: (r.push ?? []).length,
    gmail: Boolean(r.gmail),
    empty: isAbandoned(r, now),
  };
}

// What the server has and has not been given, for the "what is left to set up" list.
export function systemChecklist(): { key: string; on: boolean }[] {
  const has = (...names: string[]) => names.every((n) => Boolean((process.env[n] ?? "").trim()));
  const f = features(); // the same switches the app itself uses
  return [
    { key: "model", on: has("ANTHROPIC_API_KEY") || has("ANTHROPIC_AUTH_TOKEN") },
    { key: "storage", on: has("BLOB_READ_WRITE_TOKEN") || has("LOCAL_DATA_DIR") },
    { key: "admin", on: adminEnabled() },
    { key: "cron", on: has("CRON_SECRET") },
    { key: "gmail", on: f.gmail },
    { key: "push", on: f.push },
    { key: "billing", on: f.billing },
    { key: "digest", on: f.digest },
    { key: "inbound", on: f.inbound },
  ];
}
