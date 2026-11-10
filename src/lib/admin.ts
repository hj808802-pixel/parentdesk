import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { planOf } from "./plan";
import { createDoc, features, listDocIds, readDoc, removeDoc } from "./store";
import type { FamilyRecord } from "./types";

// The operator's console: one shared token (ADMIN_TOKEN) exchanged for an HttpOnly cookie
// holding its hash. The stats are computed by walking every family document; no item text
// or child names ever leave the server through this path.

export const ADMIN_COOKIE = "pd_admin";
const COOKIE_MAX_AGE = 12 * 3600;

// Who may sign in.
//  - The owner is ADMIN_TOKEN (with ADMIN_TOTP_SECRET as its second step). It is what
//    switches the console on and can only be changed in the environment.
//  - ADMIN_USERS adds accounts as "name:role:token[:totpSecret]" separated by commas.
//  - Accounts added from the console itself live one document each (adminuser/<id>); only
//    the hash of their token is kept, the token is shown once when the account is made.
// role is "owner" (everything) or "viewer" (may look, may not change anything).
export type AdminRole = "owner" | "viewer";
export type AdminUser = { name: string; role: AdminRole; tokenHash: string; totp: string | null; source: "env" | "stored"; createdAt?: string };
export type AdminIdentity = { name: string; role: AdminRole };

const STORED = "adminuser/";
const NAME = /^[a-z0-9_-]{1,20}$/;
const hashToken = (token: string) => createHash("sha256").update(token.trim()).digest("hex");
const storedId = (name: string) => createHash("sha256").update(`admin:${name}`).digest("hex").slice(0, 12);

export function envAdmins(): AdminUser[] {
  const users: AdminUser[] = [];
  const main = (process.env.ADMIN_TOKEN ?? "").trim();
  const mainTotp = (process.env.ADMIN_TOTP_SECRET ?? "").trim();
  if (main.length >= 16) users.push({ name: "owner", role: "owner", tokenHash: hashToken(main), totp: mainTotp.length >= 16 ? mainTotp : null, source: "env" });
  for (const part of (process.env.ADMIN_USERS ?? "").split(",")) {
    const [name, role, token, totp] = part.trim().split(":").map((x) => x.trim());
    if (!name || !NAME.test(name) || (role !== "owner" && role !== "viewer") || !token || token.length < 16) continue;
    const tokenHash = hashToken(token);
    if (users.some((u) => u.name === name || u.tokenHash === tokenHash)) continue;
    users.push({ name, role, tokenHash, totp: totp && totp.length >= 16 ? totp : null, source: "env" });
  }
  return users;
}

export function adminEnabled(): boolean {
  return envAdmins().some((u) => u.name === "owner");
}

async function storedAdmins(): Promise<AdminUser[]> {
  const out: AdminUser[] = [];
  for (const id of await listDocIds(STORED)) {
    try {
      const raw = await readDoc(`${STORED}${id}`);
      const u = raw ? (JSON.parse(raw) as Partial<AdminUser>) : null;
      if (!u || typeof u.name !== "string" || !NAME.test(u.name) || storedId(u.name) !== id) continue;
      if ((u.role !== "owner" && u.role !== "viewer") || typeof u.tokenHash !== "string" || !/^[0-9a-f]{64}$/.test(u.tokenHash)) continue;
      out.push({ name: u.name, role: u.role, tokenHash: u.tokenHash, totp: typeof u.totp === "string" && u.totp.length >= 16 ? u.totp : null, source: "stored", createdAt: typeof u.createdAt === "string" ? u.createdAt : undefined });
    } catch {
      /* an unreadable account document is simply not an account */
    }
  }
  return out.sort((x, y) => (x.name < y.name ? -1 : 1));
}

// Everyone, environment accounts first; a stored account never shadows an environment one.
export async function adminUsers(): Promise<AdminUser[]> {
  if (!adminEnabled()) return [];
  const env = envAdmins();
  const stored = (await storedAdmins()).filter((s) => !env.some((e) => e.name === s.name || e.tokenHash === s.tokenHash));
  return [...env, ...stored];
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function match(users: AdminUser[], given: unknown): AdminUser | null {
  if (typeof given !== "string" || !given.trim()) return null;
  const h = hashToken(given);
  let found: AdminUser | null = null;
  for (const u of users) if (same(h, u.tokenHash)) found = u;
  return found;
}

// The account a token belongs to.
export async function adminByToken(given: unknown): Promise<AdminUser | null> {
  return match(await adminUsers(), given);
}

// Environment accounts only (no storage read).
export function checkAdminToken(given: unknown): boolean {
  return adminEnabled() && match(envAdmins(), given) !== null;
}

// The owner's second-step secret.
export function adminTotpSecret(): string | null {
  return envAdmins().find((u) => u.name === "owner")?.totp ?? null;
}

// The session cookie is "<expiry>.<name>.<signature>". The signing key is derived from
// that account's token hash AND its second-step secret, so neither alone can forge a
// session; name, role and expiry are all inside the signature.
function sign(u: AdminUser, expiry: string): string {
  const key = createHash("sha256").update(`${u.tokenHash}|${u.totp ?? ""}|${(process.env.ADMIN_TOKEN ?? "").trim()}`).digest();
  return createHmac("sha256", key).update(`admin-session:${expiry}:${u.name}:${u.role}`).digest("hex");
}

export function adminCookieFor(u: AdminUser, secure: boolean): string {
  const expiry = String(Date.now() + COOKIE_MAX_AGE * 1000);
  return `${ADMIN_COOKIE}=${expiry}.${u.name}.${sign(u, expiry)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

// The owner's cookie (tests and older callers).
export function adminCookie(secure: boolean): string {
  const owner = envAdmins().find((u) => u.name === "owner");
  return owner ? adminCookieFor(owner, secure) : clearAdminCookie(secure);
}

export function clearAdminCookie(secure: boolean): string {
  return `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

// Who is signed in on this request, or null. An account that was removed, or whose token,
// secret or role changed, loses its sessions at once.
export async function adminOf(req: Request): Promise<AdminIdentity | null> {
  const header = req.headers.get("cookie") ?? "";
  const m = new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE}=(\\d{10,16})\\.([a-z0-9_-]{1,20})\\.([0-9a-f]{64})`).exec(header);
  if (!m || !(Number(m[1]) > Date.now())) return null;
  const u = (await adminUsers()).find((x) => x.name === m[2]);
  return u && same(m[3], sign(u, m[1])) ? { name: u.name, role: u.role } : null;
}

export async function isAdminRequest(req: Request): Promise<boolean> {
  return (await adminOf(req)) !== null;
}

// Makes an account from the console. The token (and the second-step secret, when asked
// for) is returned once and never stored in the clear.
export async function createAdmin(name: unknown, role: unknown, twoStep: boolean, newSecret: () => string): Promise<{ ok: true; name: string; role: AdminRole; token: string; totp: string | null } | { ok: false; error: "bad_name" | "bad_role" | "exists" | "too_many" }> {
  const clean = typeof name === "string" ? name.trim().toLowerCase() : "";
  if (!NAME.test(clean)) return { ok: false, error: "bad_name" };
  if (role !== "owner" && role !== "viewer") return { ok: false, error: "bad_role" };
  const all = await adminUsers();
  if (all.some((u) => u.name === clean)) return { ok: false, error: "exists" };
  if (all.length >= 20) return { ok: false, error: "too_many" };
  const token = randomBytes(24).toString("base64url");
  const totp = twoStep ? newSecret() : null;
  const doc: AdminUser = { name: clean, role, tokenHash: hashToken(token), totp, source: "stored", createdAt: new Date().toISOString() };
  // Created, never overwritten: of two requests for the same name only one gets an account.
  if (!(await createDoc(`${STORED}${storedId(clean)}`, JSON.stringify(doc)))) return { ok: false, error: "exists" };
  return { ok: true, name: clean, role, token, totp };
}

// Takes an account made in the console away again (its sessions end with it). Accounts
// from the environment are changed there.
export async function removeAdmin(name: unknown): Promise<"removed" | "not_found" | "env"> {
  const clean = typeof name === "string" ? name.trim().toLowerCase() : "";
  if (envAdmins().some((u) => u.name === clean)) return "env";
  if (!NAME.test(clean) || !(await storedAdmins()).some((u) => u.name === clean)) return "not_found";
  await removeDoc(`${STORED}${storedId(clean)}`);
  return "removed";
}

// The last n calendar days (UTC), oldest first.
export function daysBack(n: number, now: Date = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => new Date(now.getTime() - (n - 1 - i) * 86400000).toISOString().slice(0, 10));
}

// ---- aggregates ----

export type Stats = {
  generatedAt: string;
  families: { total: number; created7d: number; created30d: number; active7d: number; withChildren: number; withItems: number; truncated: boolean };
  children: number;
  items: { total: number; open: number; done: number; dismissed: number; byType: Record<string, number>; needsCheck: number };
  sources: { total: number; last7d: number; byKind: Record<string, number> };
  notices: { thisMonth: number; byDay: { day: string; n: number }[] };
  signups: { day: string; n: number }[]; // families created per day, last 30 days
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
    signups: [],
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
  s.signups = daysBack(30, now).map((day) => ({ day, n: records.filter((r) => r.createdAt.slice(0, 10) === day).length }));
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

export type FamilyRow = { id: string; createdAt: string; updatedAt: string; country: string; language: string; children: number; items: number; open: number; sources: number; monthUsage: number; plan: string; rooms: number; push: number; gmail: boolean; empty: boolean; blocked: boolean; note: string };

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

export function familyRow(r: FamilyRecord, now: Date = new Date(), admin: { note: string; blocked: boolean } = { note: "", blocked: false }): FamilyRow {
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
    empty: isAbandoned(r, now) && !admin.note && !admin.blocked,
    blocked: admin.blocked,
    note: admin.note,
  };
}

// What the server has and has not been given, for the "what is left to set up" list.
export async function systemChecklist(): Promise<{ key: string; on: boolean }[]> {
  const accounts = await adminUsers();
  const has = (...names: string[]) => names.every((n) => Boolean((process.env[n] ?? "").trim()));
  const f = features(); // the same switches the app itself uses
  return [
    { key: "twostep", on: accounts.length > 0 && accounts.every((u) => u.totp !== null) },
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
